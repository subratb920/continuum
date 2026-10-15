import { createServer, request } from "node:http";
import { connect } from "node:net";

const PATH = /^\/w\/([a-f0-9]{24})(\/.*)?$/;

/**
 * The public side: /w/<id>/… goes to that workspace's editor (OpenVSCode
 * Server, which checks the access token itself), including its live
 * connection (WebSocket). It also notes, per workspace, how many editors
 * are connected and when it was last used, for the idle stop.
 */
export function createProxy({ target, log, now = () => Date.now() }) {
  const activity = new Map(); // id → { open, lastUsed }
  const seen = (id) => {
    const a = activity.get(id) ?? { open: 0, lastUsed: now() };
    a.lastUsed = now();
    activity.set(id, a);
    return a;
  };

  const server = createServer((req, res) => {
    const m = PATH.exec(req.url.split("?")[0]);
    const to = m && target(m[1]);
    if (!to) return void page(res, 404, "There's no workspace here.");
    if (m[2] === undefined) {
      // /w/<id> → /w/<id>/ (the editor's pages are relative to it)
      res.writeHead(308, { Location: `/w/${m[1]}/${req.url.slice(`/w/${m[1]}`.length)}` }).end();
      return;
    }
    seen(m[1]);
    const up = request({ host: to.host, port: to.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${to.host}:${to.port}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) page(res, 502, "This workspace is starting (or isn't running). This page tries again every few seconds; if it stays here, open it again from Continuum.", 3);
      else res.destroy();
    });
    req.pipe(up);
  });

  // The editor's live connection: a plain TCP pipe after the upgrade request
  server.on("upgrade", (req, socket, head) => {
    const m = PATH.exec(req.url.split("?")[0]);
    const to = m && target(m[1]);
    if (!to) return void socket.destroy();
    const a = seen(m[1]);
    let counted = false;
    const up = connect(to.port, to.host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        lines.push(`${name}: ${name.toLowerCase() === "host" ? `${to.host}:${to.port}` : req.rawHeaders[i + 1]}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      a.open += 1;
      counted = true;
      socket.pipe(up).pipe(socket);
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (counted) a.open = Math.max(0, a.open - 1);
      seen(m[1]);
      socket.destroy();
      up.destroy();
    };
    // Any traffic counts as use
    socket.on("data", () => (a.lastUsed = now()));
    // Either side finishing ends both (no half-open connections left counted)
    socket.on("end", close).on("close", close).on("error", close);
    up.on("end", close).on("close", close).on("error", (e) => {
      log?.debug?.({ id: m[1], err: e.message }, "workspace connection failed");
      close();
    });
  });

  /** Workspaces with no editor connected for at least `ms` (and when they were last used). */
  function idle(ids, ms) {
    return ids.filter((id) => {
      const a = activity.get(id);
      if (!a) {
        // Running but never opened through this proxy since it started: counts from now
        activity.set(id, { open: 0, lastUsed: now() });
        return false;
      }
      return a.open === 0 && now() - a.lastUsed >= ms;
    });
  }

  const lastUsed = (id) => activity.get(id)?.lastUsed ?? null;
  const forget = (id) => activity.delete(id);

  return { server, idle, lastUsed, forget };
}

function page(res, status, text, retrySeconds = 0) {
  const retry = retrySeconds ? `<meta http-equiv="refresh" content="${retrySeconds}">` : "";
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${retry}<title>Continuum workspace</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:420px;text-align:center}</style></head><body><main><h1>Continuum workspace</h1><p>${text}</p></main></body></html>`,
  );
}
