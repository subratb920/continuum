import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// The middleware reads the server's settings when it loads. Who may use what
// is continuum-directory's (its own tests); here: how the API applies it.
Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", PORT: "0", MONGO_URI: "mongodb://x", DB_NAME: "t", JWT_SECRET: "s".repeat(32), CLIENT_ORIGIN: "http://x" });
const { requireFeature, requireFeatureByMethod, requireFeatureFor, withAccess } = await import("../src/middleware/access.js");
const { AGENTS_RULES, CREATE_RULES, DATA_RULES, WORKSPACES_RULES } = await import("../src/access/rules.js");

test("access: a feature switched off answers 403 No feature access; reading and changing can need different features; disabled accounts get nothing; old sessions end", async () => {
  const member = ["interval", "dashboard", "agents"];
  const people = {
    viewer: { features: ["dashboard"], disabled: false, tokenVersion: 0 },
    member: { features: member, disabled: false, tokenVersion: 0 },
    off: { features: member, disabled: true, tokenVersion: 0 },
    outdated: { features: member, disabled: false, tokenVersion: 1 },
  };
  const ids = Object.fromEntries(Object.keys(people).map((k) => [k, k]));
  // The directory's answer for each (continuum-directory decides it)
  const accessFor = async (id) => (people[id] ? { userId: id, ...people[id] } : null);

  const app = express();
  // Tokens carry the session version they were made with (here 0: before any "sign out everywhere")
  app.use((req, _res, next) => ((req.user = { id: ids[req.get("x-who")], tv: 0 }), next()));
  app.use(withAccess({ accessFor }));
  app.get("/brain", requireFeature("agents"), (_req, res) => res.json({ ok: true }));
  app.all("/projects", requireFeatureByMethod({ read: ["interval", "dashboard"], write: ["interval"] }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, who) => fetch(base + path, { method, headers: { "x-who": who } });

  try {
    const refused = await call("GET", "/brain", "viewer");
    assert.equal(refused.status, 403);
    const body = await refused.json();
    assert.deepEqual([body.code, body.feature], ["NO_FEATURE_ACCESS", "agents"]);
    assert.match(body.error, /^No feature access: Brain agents isn't switched on for your role/);
    assert.equal((await call("GET", "/brain", "member")).status, 200);

    assert.equal((await call("GET", "/projects", "viewer")).status, 200, "the dashboard reads projects");
    assert.equal((await call("POST", "/projects", "viewer")).status, 403, "changing them is Interval Setup");
    assert.equal((await call("POST", "/projects", "member")).status, 200);

    const disabled = await call("GET", "/brain", "off");
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).code, "ACCOUNT_DISABLED");

    // Signed out everywhere since the token was made: sign in again
    const ended = await call("GET", "/brain", "outdated");
    assert.equal(ended.status, 401);
    assert.equal((await ended.json()).code, "SESSION_ENDED");
  } finally {
    server.close();
  }
});

test("access: Agents and Data refuse what a role switched off, request by request", async () => {
  const run = (rules, features, method, path) => {
    let passed = false;
    let refused = null;
    const res = { status: () => ({ json: (b) => (refused = b) }) };
    requireFeatureFor(rules)({ method, path, access: { features } }, res, () => (passed = true));
    return passed ? "ok" : refused.feature;
  };
  const viewer = ["agents", "data"];
  assert.equal(run(AGENTS_RULES, viewer, "GET", "/agents"), "ok", "seeing needs only the app");
  assert.equal(run(AGENTS_RULES, viewer, "POST", "/agents"), "agents_run");
  assert.equal(run(AGENTS_RULES, viewer, "POST", "/agents/a1/push"), "agents_push");
  assert.equal(run(AGENTS_RULES, viewer, "DELETE", "/agents/a1"), "agents_manage");
  assert.equal(run(AGENTS_RULES, viewer, "PUT", "/settings"), "agents_settings");
  assert.equal(run(AGENTS_RULES, [...viewer, "agents_run"], "POST", "/agents/a1/reply"), "ok");
  assert.equal(run(DATA_RULES, viewer, "GET", "/datasets"), "ok");
  assert.equal(run(DATA_RULES, viewer, "POST", "/sources"), "data_sources");
  assert.equal(run(DATA_RULES, viewer, "GET", "/credentials"), "data_credentials", "saved logins aren't even listed");
  assert.equal(run(DATA_RULES, viewer, "POST", "/runs/r1/retry"), "data_recipes");
  assert.equal(run(DATA_RULES, viewer, "GET", "/versions/v1/exports/csv/download"), "data_publish");
  assert.equal(run(CREATE_RULES, ["create"], "POST", "/preview"), "ok", "previews need only Create");
  assert.equal(run(CREATE_RULES, ["create"], "POST", "/generate"), "create_generate");
  assert.equal(run(WORKSPACES_RULES, ["workspaces"], "GET", "/"), "ok");
  assert.equal(run(WORKSPACES_RULES, ["workspaces"], "POST", "/"), "workspaces_create");
  assert.equal(run(WORKSPACES_RULES, ["workspaces"], "POST", "/w1/open"), "workspaces_start");
  assert.equal(run(WORKSPACES_RULES, ["workspaces"], "DELETE", "/w1"), "workspaces_manage");
});

