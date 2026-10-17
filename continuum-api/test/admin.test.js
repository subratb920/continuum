import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

/**
 * The admin area against a real MongoDB (MONGO_TEST_URL names a throwaway
 * database, emptied first). Skipped without it.
 */
const url = process.env.MONGO_TEST_URL;
const skip = !url ? "MONGO_TEST_URL not set" : false;

Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", PORT: "0", MONGO_URI: "mongodb://x", DB_NAME: "t", JWT_SECRET: "s".repeat(32), CLIENT_ORIGIN: "http://x" });
const { ensureAccess, clearAccessCache } = await import("../src/access/access.js");
const { ensureActivity } = await import("../src/access/activity.js");
const { withAccess, requireFeature } = await import("../src/middleware/access.js");
const { createAdminRouter } = await import("../src/admin/admin.routes.js");
const { errorMiddleware } = await import("../src/middleware/error.middleware.js");

const env = { ADMIN_EMAILS: "boss@x.test" };
let client, db, server, base;
const ids = {};

before(async () => {
  if (skip) return;
  client = await MongoClient.connect(url);
  db = client.db();
  await db.dropDatabase();
  await ensureAccess(db);
  await ensureActivity(db);
  const now = Date.now();
  for (const [k, doc] of Object.entries({
    boss: { email: "boss@x.test" }, // ADMIN_EMAILS
    admin: { email: "admin@x.test", roleId: "admin" },
    ana: { email: "ana@x.test", roleId: "member", githubId: 7, github: { login: "ana-gh", name: "Ana", avatarUrl: null }, lastSeenAt: new Date(now - 3600_000) },
    old: { email: "old@x.test", lastSeenAt: new Date(now - 30 * 86_400_000) }, // from before roles: a member
  })) {
    const r = await db.collection("users").insertOne({ ...doc, passwordHash: "secret-hash", githubAccessToken: "gho_secret", createdAt: new Date(now - Object.keys(ids).length * 1000) });
    ids[k] = r.insertedId;
  }
  await db.collection("login_events").insertMany([
    { userId: ids.ana, email: "ana@x.test", method: "github", ok: true, at: new Date(now - 3600_000), ip: "203.0.113.7", device: "phone", browser: "Safari 17.4" },
    { userId: null, email: "ana@x.test", method: "email", ok: false, reason: "wrong email or password", at: new Date(now - 7200_000), ip: "198.51.100.9" },
  ]);
  await db.collection("app_usage").insertMany([
    { _id: `${ids.ana}:agents:2026-10-16`, userId: ids.ana, app: "agents", day: "2026-10-16", count: 5, lastAt: new Date(now - 86_400_000) },
    { _id: `${ids.ana}:agents:2026-10-17`, userId: ids.ana, app: "agents", day: "2026-10-17", count: 3, lastAt: new Date(now - 3600_000) },
    { _id: `${ids.ana}:deploy:2026-10-17`, userId: ids.ana, app: "deploy", day: "2026-10-17", count: 1, lastAt: new Date(now - 3600_000) },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => ((req.user = { id: ids[req.get("x-who")] }), (req.log = { info() {}, warn() {} }), next()));
  app.use("/admin", withAccess({ db: () => db, env }), requireFeature("admin"), createAdminRouter({ db: () => db, env }));
  app.use(errorMiddleware);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/admin`;
});

after(async () => {
  if (skip) return;
  server.close();
  await db.dropDatabase();
  await client.close();
});

const call = async (method, path, body, who = "admin") => {
  clearAccessCache();
  const r = await fetch(base + path, { method, headers: { "x-who": who, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("admin: only admins get in (a role with admin, or ADMIN_EMAILS)", { skip }, async () => {
  assert.equal((await call("GET", "/users", null, "ana")).status, 403);
  assert.equal((await call("GET", "/users", null, "boss")).status, 200);
  assert.equal((await call("GET", "/users")).status, 200);
});

test("admin: users list — role, how they sign in, last seen, device, apps used; never passwords or tokens; search and filters", { skip }, async () => {
  const { body } = await call("GET", "/users");
  assert.equal(body.total, 4);
  assert.ok(!JSON.stringify(body).includes("secret"), "no password hash or GitHub token");
  const ana = body.users.find((u) => u.email === "ana@x.test");
  assert.deepEqual([ana.signsInWith, ana.github.login, ana.role.name], ["github", "ana-gh", "Member"]);
  assert.deepEqual(ana.apps.map((a) => [a.app, a.count, a.days]), [["agents", 8, 2], ["deploy", 1, 1]], "most used first, across days");
  assert.deepEqual(body.users.find((u) => u.email === "boss@x.test").role, { id: "admin", name: "Admin" });
  assert.equal(body.users.find((u) => u.email === "boss@x.test").adminByEmail, true);

  assert.deepEqual((await call("GET", "/users?search=ANA-GH")).body.users.map((u) => u.email), ["ana@x.test"], "by GitHub login, any case");
  assert.deepEqual((await call("GET", "/users?role=admin")).body.users.map((u) => u.email).sort(), ["admin@x.test", "boss@x.test"]);
  assert.deepEqual((await call("GET", "/users?role=member")).body.users.map((u) => u.email).sort(), ["ana@x.test", "old@x.test"], "no roleId: member");
  assert.deepEqual((await call("GET", "/users?seenDays=7")).body.users.map((u) => u.email), ["ana@x.test"]);
});

test("admin: one user — sign-ins (refused ones too), apps, projects", { skip }, async () => {
  const { body } = await call("GET", `/users/${ids.ana}`);
  assert.deepEqual(body.logins.map((l) => [l.method, l.ok]), [["github", true], ["email", false]], "newest first, a refused email sign-in too");
  assert.equal(body.logins[0].device, "phone");
  assert.equal(body.projects, 0);
  assert.equal((await call("GET", `/users/${new ObjectId()}`)).status, 404);
});

test("admin: roles — create with features switched on, switch them, defaults, delete moving users; admin and built-ins are safe", { skip }, async () => {
  const made = await call("POST", "/roles", { name: "Viewer", description: "Look only", features: ["dashboard", "interval"] });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.id, made.body.features], ["viewer", ["interval", "dashboard"]]);
  assert.equal((await call("POST", "/roles", { name: "viewer", features: [] })).status, 409, "names are unique");
  assert.equal((await call("POST", "/roles", { name: "Bad", features: ["root"] })).status, 400, "only known features");

  const switched = await call("PATCH", "/roles/viewer", { features: ["dashboard", "agents"] });
  assert.deepEqual(switched.body.features, ["dashboard", "agents"]);
  assert.equal((await call("PATCH", "/roles/admin", { features: ["dashboard"] })).status, 409, "admin always has everything");
  assert.equal((await call("PATCH", "/roles/member", { name: "Staff" })).status, 409, "built-ins keep their name");

  // Ana to Viewer: her access follows
  assert.equal((await call("PATCH", `/users/${ids.ana}`, { roleId: "viewer" })).body.role.id, "viewer");
  assert.equal((await call("GET", "/users", null, "ana")).status, 403);
  clearAccessCache();
  const { accessFor } = await import("../src/access/access.js");
  assert.deepEqual((await accessFor(db, ids.ana, { env })).features, ["dashboard", "agents"]);

  // The default for new users, then deleting the role: its users and the default move
  assert.equal((await call("PUT", "/settings", { defaultRoleId: "viewer" })).body.defaultRoleId, "viewer");
  assert.equal((await call("DELETE", "/roles/member")).status, 409, "built-ins stay");
  const gone = await call("DELETE", "/roles/viewer?moveTo=member");
  assert.deepEqual([gone.body.moved, gone.body.movedTo], [1, "member"]);
  assert.equal((await call("GET", "/settings")).body.defaultRoleId, "member");
  assert.equal((await db.collection("users").findOne({ _id: ids.ana })).roleId, "member");

  const roles = (await call("GET", "/roles")).body;
  assert.deepEqual(roles.map((r) => r.id), ["admin", "member"]);
  assert.equal(roles.find((r) => r.id === "admin").users, 2, "the admin role and ADMIN_EMAILS");
});

test("admin: disabling — not yourself, not an ADMIN_EMAILS admin; a disabled user is shut out; every change is audited", { skip }, async () => {
  assert.equal((await call("PATCH", `/users/${ids.admin}`, { disabled: true })).status, 409, "not yourself");
  assert.equal((await call("PATCH", `/users/${ids.boss}`, { disabled: true })).status, 409, "ADMIN_EMAILS");
  assert.equal((await call("PATCH", `/users/${ids.boss}`, { roleId: "member" })).status, 409, "ADMIN_EMAILS keep admin");
  assert.equal((await call("PATCH", `/users/${ids.ana}`, { disabled: true })).body.disabled, true);
  clearAccessCache();
  const { accessFor } = await import("../src/access/access.js");
  assert.equal((await accessFor(db, ids.ana, { env })).disabled, true);
  assert.equal((await call("PATCH", `/users/${ids.ana}`, { disabled: false })).body.disabled, false);

  const changes = (await call("GET", "/changes")).body;
  assert.ok(changes.some((a) => a.type === "ADMIN_USER_UPDATED" && a.metadata.after.disabled === true && a.byEmail === "admin@x.test"), "disabling Ana is recorded, with who did it");
  assert.ok(changes.some((a) => a.type === "ADMIN_ROLE_CREATED"));
  assert.ok(changes.some((a) => a.type === "ADMIN_ROLE_DELETED"));
});

test("admin: recent sign-ins across everyone, refused ones alone on request", { skip }, async () => {
  assert.equal((await call("GET", "/activity")).body.length, 2);
  assert.deepEqual((await call("GET", "/activity?failed=1")).body.map((l) => l.reason), ["wrong email or password"]);
});
