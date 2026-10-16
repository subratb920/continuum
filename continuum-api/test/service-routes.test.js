import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ObjectId } from "mongodb";
import { createServiceRouter, sameSecret } from "../src/service/routes.js";

const ME = new ObjectId("a".repeat(24));
const OTHER = new ObjectId("b".repeat(24));
const P1 = new ObjectId("c".repeat(24));
const P2 = new ObjectId("d".repeat(24));
const TOKEN = "s".repeat(40);

/** Just enough of MongoDB for these routes: equality filters on top-level fields. */
function fakeDb(data) {
  const match = (doc, filter) => Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));
  return {
    collection: (name) => ({
      find: (filter) => {
        const rows = (data[name] ?? []).filter((d) => match(d, filter));
        const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => rows };
        return cursor;
      },
      findOne: async (filter) => (data[name] ?? []).find((d) => match(d, filter)) ?? null,
    }),
  };
}

const db = fakeDb({
  projects: [
    { _id: P1, userId: ME, name: "Shop", source: "github", fullName: "octo/shop", bridgeCount: 1, createdAt: new Date("2026-01-01") },
    { _id: P2, userId: OTHER, name: "Theirs", source: "local" },
  ],
  bridges: [{ _id: new ObjectId("e".repeat(24)), projectId: P1, bridgeName: "bridge-1", index: 1, status: "draft", interval: { mode: "focus", duration: 50, startedAt: new Date("2026-01-02") }, sessionGoals: [{ id: "g", text: "Footer", status: "untouched" }, { text: "No id", status: "untouched" }] }, { _id: new ObjectId("f".repeat(24)), projectId: P2, bridgeName: "bridge-9", index: 9, status: "draft" }],
  execution_state: [{ userId: ME, activeProjectId: P1 }],
  users: [{ _id: ME, email: "me@example.com", name: "Me", githubAccessToken: "gho_x" }],
});

async function serve(token) {
  const app = express();
  app.use("/service", createServiceRouter({ db, token }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/service`;
  const get = (path, { user = String(ME), auth = `Bearer ${TOKEN}` } = {}) => fetch(`${base}${path}`, { headers: { Authorization: auth, "X-Continuum-User": user } });
  return { get, close: () => server.close() };
}

test("service routes: only with the service token and a user ID; off until the token is set", async () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abd", "abc"), false);
  const off = await serve(undefined);
  const saved = process.env.CONTINUUM_SERVICE_TOKEN;
  delete process.env.CONTINUUM_SERVICE_TOKEN;
  assert.equal((await off.get("/projects")).status, 503);
  if (saved !== undefined) process.env.CONTINUUM_SERVICE_TOKEN = saved;
  off.close();
  const s = await serve(TOKEN);
  assert.equal((await s.get("/projects", { auth: "Bearer wrong" })).status, 401);
  assert.equal((await s.get("/projects", { auth: "" })).status, 401);
  assert.equal((await s.get("/projects", { user: "../x" })).status, 400);
  s.close();
});

test("service routes: the user's own projects, bridges and interval only; read-only views", async () => {
  const s = await serve(TOKEN);
  const projects = await (await s.get("/projects")).json();
  assert.deepEqual(projects.map((p) => [p.name, p.repo]), [["Shop", "octo/shop"]]);
  assert.equal((await s.get(`/projects/${P2}`)).status, 404, "another user's project");
  assert.equal((await s.get(`/projects/${P2}/bridges`)).status, 404);
  assert.equal((await s.get("/projects/nope")).status, 404);
  const bridges = await (await s.get(`/projects/${P1}/bridges`)).json();
  assert.deepEqual(bridges[0].goals, [{ id: "g", text: "Footer", status: "untouched" }, { id: "g2", text: "No id", status: "untouched" }]);
  // One bridge, with its project: only when the project is the user's
  const one = await (await s.get(`/bridges/${"e".repeat(24)}`)).json();
  assert.deepEqual([one.id, one.projectId, one.goals.length], ["e".repeat(24), String(P1), 2]);
  assert.equal((await s.get(`/bridges/${"f".repeat(24)}`)).status, 404, "another user's bridge");
  assert.equal((await s.get("/bridges/nope")).status, 404);
  assert.equal(bridges[0].interval.minutes, 50);
  const interval = await (await s.get("/interval")).json();
  assert.equal(interval.activeProject.name, "Shop");
  assert.equal(interval.bridge.name, "bridge-1");
  const none = await (await s.get("/interval", { user: String(OTHER) })).json();
  assert.deepEqual(none, { activeProject: null, bridge: null });
  s.close();
});

test("service routes: the GitHub sign-in and commit name, for the named user only; never cached", async () => {
  const s = await serve(TOKEN);
  const r = await s.get("/github");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { token: "gho_x", author: { name: "Me", email: "me@example.com" } });
  assert.deepEqual(await (await s.get("/github", { user: String(OTHER) })).json(), { token: null, author: null });
  s.close();
});
