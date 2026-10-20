import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { build } from "../build.mjs";

build();
const { server } = await import("../server.mjs");
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
after(() => server.close());

const get = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    request({ port, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    })
      .on("error", reject)
      .end();
  });

test("pages at clean addresses; a trailing slash and index.html go to the clean one", async () => {
  assert.equal((await get("/ai-ide")).status, 200);
  assert.equal((await get("/")).status, 200);
  const slash = await get("/ai-ide/");
  assert.equal(slash.status, 301);
  assert.equal(slash.headers.location, "/ai-ide");
  assert.equal((await get("/ai-ide/index.html")).headers.location, "/ai-ide");
});

test("www goes to the one address (the domain itself), same page", async () => {
  const r = await get("/teams?x=1", { host: "www.continuum-console.one" });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, "https://continuum-console.one/teams?x=1");
});

test("unknown pages are a real 404 (not a soft one); text is gzipped", async () => {
  const r = await get("/nope");
  assert.equal(r.status, 404);
  assert.match(r.body, /noindex/);
  assert.equal((await get("/", { "accept-encoding": "gzip" })).headers["content-encoding"], "gzip");
  assert.equal((await get("/sitemap.xml")).headers["content-type"], "application/xml; charset=utf-8");
});
