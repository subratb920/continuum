import { createServer } from "node:http";
import { WorkspaceError } from "./workspaces.js";

const ROUTE = /^\/internal\/workspaces\/([^/]+)(\/start|\/stop|\/open)?$/;
const MAX_BODY = 16 * 1024;

/**
 * The internal API, for continuum-api only (never published: the cloud and
 * Docker keep it on the private network):
 *   GET    /health
 *   GET    /internal/workspaces/:id        { state, startedAt?, lastUsed? }
 *   POST   /internal/workspaces/:id/start  { repo, githubToken, size, author } → { path }
 *   POST   /internal/workspaces/:id/open   a running one's way in → { path } (409: not running)
 *   POST   /internal/workspaces/:id/stop
 *   DELETE /internal/workspaces/:id
 */
export function createApi({ workspaces, proxy, log }) {
  return createServer(async (req, res) => {
    const json = (status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    try {
      if (req.url === "/health") return void json(200, { status: "ok" });
      const m = ROUTE.exec(req.url);
      if (!m) return void json(404, { error: "Not found." });
      const [, id, action] = m;
      if (req.method === "GET" && !action) {
        const s = await workspaces.status(id);
        return void json(200, { ...s, lastUsed: proxy.lastUsed(id) });
      }
      if (req.method === "POST" && action === "/start") {
        const body = await readJson(req);
        const started = await workspaces.start({ id, repo: body.repo, githubToken: body.githubToken, size: body.size, author: body.author });
        log.info({ id, repo: body.repo, size: body.size ?? "standard" }, "workspace started");
        return void json(202, started);
      }
      if (req.method === "POST" && action === "/open") {
        const opened = await workspaces.open(id);
        return void (opened ? json(200, opened) : json(409, { error: "This workspace isn't running." }));
      }
      if (req.method === "POST" && action === "/stop") {
        const stopped = await workspaces.stop(id);
        proxy.forget(id);
        log.info({ id }, "workspace stopped");
        return void json(200, stopped);
      }
      if (req.method === "DELETE" && !action) {
        const removed = await workspaces.remove(id);
        proxy.forget(id);
        log.info({ id }, "workspace deleted");
        return void json(200, removed);
      }
      json(405, { error: "Method not allowed." });
    } catch (e) {
      if (e instanceof WorkspaceError) return void json(e.status, { error: e.message });
      log.error({ err: e.message }, "workspace request failed");
      json(502, { error: "The workspace couldn't be changed right now. Try again in a moment." });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) return void req.destroy(new WorkspaceError(413, "Too large."));
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new WorkspaceError(400, "The request isn't JSON."));
      }
    });
    req.on("error", reject);
  });
}
