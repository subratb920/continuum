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
      updateOne: async (filter, { $set }) => {
        const doc = (data[name] ?? []).find((d) => match(d, filter));
        if (!doc) return { matchedCount: 0 };
        for (const [k, v] of Object.entries($set)) {
          const path = k.split(".");
          let at = doc;
          for (const p of path.slice(0, -1)) at = at[p] ??= {};
          at[path.at(-1)] = v;
        }
        return { matchedCount: 1 };
      },
    }),
  };
}

// An agent interval: the brain works its goals (no duration)
const AGENT = new ObjectId("9".repeat(24));
const W1 = "a1".repeat(12);
const W2 = "b2".repeat(12);
const agentBridge = { _id: AGENT, projectId: P1, index: 3, status: "draft", interval: { kind: "agent", mode: "Execution", duration: null, startedAt: new Date("2026-01-03") }, sessionGoals: [{ id: "g1", text: "Add email validation", status: "untouched" }, { id: "g2", text: "Fix login redirect", status: "untouched" }] };

const data = {
  projects: [
    { _id: P1, userId: ME, name: "Shop", source: "github", fullName: "octo/shop", bridgeCount: 1, createdAt: new Date("2026-01-01") },
    { _id: P2, userId: OTHER, name: "Theirs", source: "local" },
  ],
  bridges: [{ _id: new ObjectId("e".repeat(24)), projectId: P1, bridgeName: "bridge-1", index: 1, status: "draft", interval: { mode: "focus", duration: 50, startedAt: new Date("2026-01-02") }, sessionGoals: [{ id: "g", text: "Footer", status: "untouched" }, { text: "No id", status: "untouched" }] }, { _id: new ObjectId("f".repeat(24)), projectId: P2, bridgeName: "bridge-9", index: 9, status: "draft" }, { _id: new ObjectId("1".repeat(24)), projectId: P1, index: 2, status: "finalized" }],
  execution_state: [{ userId: ME, activeProjectId: P1 }],
  users: [{ _id: ME, email: "me@example.com", name: "Me", githubAccessToken: "gho_x" }],
};
data.bridges.push(agentBridge);
const db = fakeDb(data);

async function serve(token) {
  const app = express();
  app.use(express.json());
  app.use("/service", createServiceRouter({ db, token }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/service`;
  const get = (path, { user = String(ME), auth = `Bearer ${TOKEN}` } = {}) => fetch(`${base}${path}`, { headers: { Authorization: auth, "X-Continuum-User": user } });
  const send = (method, path, body, { user = String(ME) } = {}) => fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "X-Continuum-User": user, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { get, send, close: () => server.close() };
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
  assert.deepEqual(bridges[0].goals, [{ id: "g", text: "Footer", status: "untouched", tasks: [], verification: null }, { id: "g2", text: "No id", status: "untouched", tasks: [], verification: null }]);
  assert.equal(bridges[0].interval.kind, "human", "a bridge from before agent intervals is a human one");
  // One bridge, with its project: only when the project is the user's
  const one = await (await s.get(`/bridges/${"e".repeat(24)}`)).json();
  assert.equal(one.name, "bridge-1");
  assert.equal((await (await s.get(`/bridges/${"1".repeat(24)}`)).json()).name, "bridge-2", "an older bridge without bridgeName");
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

test("service routes: the brain works an agent interval's bridge — tasks, workers, verdicts, then finish; never a human one or another user's", async () => {
  const s = await serve(TOKEN);
  const B = `/bridges/${AGENT}`;
  // A human interval is the person's
  assert.equal((await s.send("PUT", `/bridges/${"e".repeat(24)}/goals/g/tasks`, { tasks: [{ text: "x" }] })).status, 409);
  // Another user can't touch it
  assert.equal((await s.send("PUT", `${B}/goals/g1/tasks`, { tasks: [{ text: "x" }] }, { user: String(OTHER) })).status, 404);
  // Plan: goal 1 in two tasks
  const planned = await (await s.send("PUT", `${B}/goals/g1/tasks`, { tasks: [{ id: "1.1", text: "Validate format in the form" }, { id: "1.2", text: "Server-side check" }] })).json();
  assert.equal(planned.interval.kind, "agent");
  assert.deepEqual(planned.goals[0].tasks.map((t) => [t.id, t.state, t.agentId]), [["1.1", "planned", null], ["1.2", "planned", null]]);
  assert.equal((await s.send("PUT", `${B}/goals/g1/tasks`, { tasks: [] })).status, 400, "at least one task");
  assert.equal((await s.send("PUT", `${B}/goals/nope/tasks`, { tasks: [{ text: "x" }] })).status, 404);
  // Workers on them
  assert.equal((await s.send("PATCH", `${B}/goals/g1/tasks/1.1`, { agentId: W1, state: "working" })).status, 200);
  assert.equal((await s.send("PATCH", `${B}/goals/g1/tasks/1.1`, { state: "sleeping" })).status, 400);
  assert.equal((await s.send("PATCH", `${B}/goals/g1/tasks/9.9`, { state: "done" })).status, 404);
  await s.send("PATCH", `${B}/goals/g1/tasks/1.1`, { state: "done" });
  await s.send("PATCH", `${B}/goals/g1/tasks/1.2`, { agentId: W2, state: "done" });
  // Re-planning keeps a task's worker and state by id
  const replanned = await (await s.send("PUT", `${B}/goals/g1/tasks`, { tasks: [{ id: "1.1", text: "Validate format in the form" }, { id: "1.2", text: "Server-side check" }, { id: "1.3", text: "Tests" }] })).json();
  assert.deepEqual(replanned.goals[0].tasks.map((t) => t.state), ["done", "done", "planned"]);
  // Finish needs every goal's verdict
  assert.equal((await s.send("POST", `${B}/finish`)).status, 409);
  const v1 = await (await s.send("POST", `${B}/goals/g1/verdict`, { verdict: "completed", note: "Both checks pass; tests added." })).json();
  assert.deepEqual([v1.goals[0].status, v1.goals[0].verification.verdict], ["completed", "completed"]);
  assert.equal((await s.send("PUT", `${B}/goals/g1/tasks`, { tasks: [{ text: "more" }] })).status, 409, "no re-planning after the verdict");
  assert.equal((await s.send("POST", `${B}/goals/g2/verdict`, { verdict: "maybe" })).status, 400);
  await s.send("POST", `${B}/goals/g2/verdict`, { verdict: "incomplete", note: "Needs a design decision." });
  const done = await (await s.send("POST", `${B}/finish`, { agentNames: { [W1]: "worker a1a1" } })).json();
  assert.equal(done.status, "finalized");
  assert.ok(done.interval.endedAt);
  const stored = agentBridge;
  assert.equal(stored.interval.endedBy, "brain");
  assert.deepEqual(stored.sessionGoals[0].agents.map((a) => [a.name, a.task, a.state]), [["worker a1a1", "Validate format in the form", "done"], [`worker ${W2.slice(-4)}`, "Server-side check", "done"]]);
  // Ended: nothing more
  assert.equal((await s.send("POST", `${B}/goals/g1/verdict`, { verdict: "completed" })).status, 409);
  s.close();
});
