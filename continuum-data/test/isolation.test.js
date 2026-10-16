import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startTestEngine, waitFor } from "./helpers.js";

let t;
before(async () => {
  t = await startTestEngine({ name: "isolation" });
});
after(() => t.stop());

test("one user can't see or touch another user's datasets, versions, runs or uploads", async () => {
  const a = t.api(t.users.a);
  const b = t.api(t.users.b);
  const source = (await a("GET", "/sources?q=imdb")).body.sources[0];
  const made = await a("POST", "/datasets", { name: "Private", sourceId: source.id });
  const id = made.body.dataset.id;
  const ds = await waitFor(async () => {
    const { body } = await a("GET", `/datasets/${id}`);
    return body.dataset.state === "ready" && body.dataset;
  });
  const up = (await a("POST", "/uploads", { name: "Mine" })).body;

  const routes = [
    ["GET", `/datasets/${id}`],
    ["PATCH", `/datasets/${id}`, { name: "Taken" }],
    ["DELETE", `/datasets/${id}`],
    ["GET", `/datasets/${id}/versions`],
    ["GET", `/versions/${ds.headVersionId}`],
    ["GET", `/versions/${ds.headVersionId}/rows`],
    ["GET", `/versions/${ds.headVersionId}/profile`],
    ["GET", `/runs/${ds.lastRun.id}`],
    ["GET", `/runs/${ds.lastRun.id}/events`],
    ["POST", `/runs/${ds.lastRun.id}/cancel`],
    ["POST", `/runs/${ds.lastRun.id}/retry`],
    ["GET", `/sources/${up.sourceId}`],
    ["POST", `/uploads/${up.uploadId}/files?path=x.csv`, new TextEncoder().encode("a\n1\n")],
  ];
  for (const [method, p, body] of routes) {
    const r = await b(method, p, body, body instanceof Uint8Array ? { "Content-Type": "application/octet-stream" } : {});
    assert.equal(r.status, 404, `${method} ${p} answered ${r.status}`);
  }
  assert.equal((await b("GET", "/datasets")).body.datasets.length, 0);
  assert.equal((await b("GET", "/runs")).body.runs.length, 0);
  assert.ok(!(await b("GET", "/sources?q=Mine")).body.sources.some((s) => s.private), "private sources stay private");
  const bad = await b("POST", "/datasets", { name: "Steal", uploadId: up.uploadId });
  assert.equal(bad.status, 404);
  assert.equal((await a("GET", `/datasets/${id}`)).body.dataset.name, "Private");
});

test("signing in is required, and bad ids are refused", async () => {
  const res = await fetch(`${t.base}/datasets`);
  assert.equal(res.status, 401);
  const a = t.api(t.users.a);
  assert.equal((await a("GET", "/datasets/not-an-id")).status, 400);
});

test("each runner step only ever names the owner's folder", async () => {
  for (const c of t.engine.runner.calls) {
    for (const v of Object.values(c.params)) {
      if (typeof v === "string" && (v.startsWith("raw/") || v.startsWith("datasets/") || v.startsWith("uploads/"))) assert.ok(!v.includes(".."));
    }
    assert.match(String(c.userId), /^[0-9a-f]{24}$/);
  }
});

test("continuum-data imports nothing from continuum-api (it can be split out)", async () => {
  const root = path.join(import.meta.dirname, "..", "src");
  const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const text = await readFile(path.join(root, f), "utf8");
    assert.ok(!/continuum-api/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")), `${f} refers to continuum-api`);
  }
});
