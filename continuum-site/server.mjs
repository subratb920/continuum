// continuum-site: serves dist/ (built by build.mjs) on $PORT (45195).
//   /topic → dist/topic/index.html; /topic/ → 301 /topic; unknown → 404.html
//   www.<domain> → 301 to SITE_URL's host, same path (one address for search engines)
// Everything is read once at start, with a gzip copy of text files.

import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "./build.mjs";

const DIST = fileURLToPath(new URL("./dist", import.meta.url));
const PORT = Number(process.env.PORT) || 45195;
const SITE_HOST = new URL(SITE_URL).host;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const TEXT = new Set([".html", ".css", ".xml", ".txt", ".svg", ".webmanifest"]);

/** Every file: "/path" → { body, gz?, type, html } */
function load(dir, files = new Map()) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) load(full, files);
    else {
      const ext = extname(name);
      const body = readFileSync(full);
      files.set(`/${relative(DIST, full).split(sep).join("/")}`, { body, gz: TEXT.has(ext) ? gzipSync(body) : null, type: TYPES[ext] ?? "application/octet-stream", html: ext === ".html" });
    }
  }
  return files;
}
const FILES = load(DIST);

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function send(req, res, status, file) {
  const gzip = file.gz && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  res.writeHead(status, {
    ...HEADERS,
    "Content-Type": file.type,
    // Pages: always checked again (they change with each deploy); images and styles: a day
    "Cache-Control": file.html ? "public, max-age=0, must-revalidate" : "public, max-age=86400",
    Vary: "Accept-Encoding",
    ...(gzip ? { "Content-Encoding": "gzip" } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : gzip ? file.gz : file.body);
}

const redirect = (res, to) => (res.writeHead(301, { ...HEADERS, Location: to }), res.end());

export const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, { Allow: "GET, HEAD" }), res.end();
  const host = (req.headers.host ?? "").toLowerCase();
  const { pathname, search } = new URL(req.url, "http://x");
  if (pathname === "/healthz") return res.writeHead(200, { "Content-Type": "text/plain" }), res.end("ok");
  // www → the one address (keeps search engines from splitting a page in two)
  if (host === `www.${SITE_HOST}`) return redirect(res, `${SITE_URL}${pathname}${search}`);
  if (pathname.length > 1 && pathname.endsWith("/")) return redirect(res, `${pathname.replace(/\/+$/, "")}${search}`);
  if (pathname.endsWith("/index.html")) return redirect(res, `${pathname.slice(0, -"index.html".length).replace(/(.)\/$/, "$1")}${search}`);
  const file = FILES.get(pathname) ?? FILES.get(pathname === "/" ? "/index.html" : `${pathname}/index.html`);
  if (file) return send(req, res, 200, file);
  send(req, res, 404, FILES.get("/404.html"));
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`continuum-site on :${PORT} (${FILES.size} files, ${SITE_URL})`));
}
