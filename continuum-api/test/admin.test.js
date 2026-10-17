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
const { ensureAccess, ensureOwners, clearAccessCache, prepareAdminSetup, claimAdmin, adminSetupOpen } = await import("../src/access/access.js");
const { ensureActivity } = await import("../src/access/activity.js");
const { withAccess, requireFeature } = await import("../src/middleware/access.js");
const { createAdminRouter } = await import("../src/admin/admin.routes.js");
const { errorMiddleware } = await import("../src/middleware/error.middleware.js");

const env = {};
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
  app.use((req, _res, next) => ((req.user = { id: ids[req.get("x-who")], tv: Number(req.get("x-tv") ?? 0) }), (req.log = { info() {}, warn() {} }), next()));
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

const call = async (method, path, body, who = "admin", tv = 0) => {
  clearAccessCache();
  const r = await fetch(base + path, { method, headers: { "x-who": who, "x-tv": String(tv), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("admin: only admins get in (the admin role, in this database)", { skip }, async () => {
  assert.equal((await call("GET", "/users", null, "ana")).status, 403);
  assert.equal((await call("GET", "/users")).status, 200);
});

test("admin: users list — role, how they sign in, last seen, device, apps used; never passwords or tokens; search and filters", { skip }, async () => {
  const { body } = await call("GET", "/users");
  assert.equal(body.total, 3);
  assert.ok(!JSON.stringify(body).includes("secret"), "no password hash or GitHub token");
  const ana = body.users.find((u) => u.email === "ana@x.test");
  assert.deepEqual([ana.signsInWith, ana.github.login, ana.role.name], ["github", "ana-gh", "Member"]);
  assert.deepEqual(ana.apps.map((a) => [a.app, a.count, a.days]), [["agents", 8, 2], ["deploy", 1, 1]], "most used first, across days");
  assert.deepEqual(body.users.find((u) => u.email === "admin@x.test").role, { id: "admin", name: "Admin" });

  assert.deepEqual((await call("GET", "/users?search=ANA-GH")).body.users.map((u) => u.email), ["ana@x.test"], "by GitHub login, any case");
  assert.deepEqual((await call("GET", "/users?role=admin")).body.users.map((u) => u.email), ["admin@x.test"]);
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
  assert.equal(roles.find((r) => r.id === "admin").users, 1);
});

test("admin: the last admin stays; nobody disables themself; disabling signs out everywhere; every change is recorded", { skip }, async () => {
  const last = await call("PATCH", `/users/${ids.admin}`, { roleId: "member" });
  assert.deepEqual([last.status, last.body.code], [409, "LAST_ADMIN"], "the only admin can't stop being one");
  assert.equal((await call("PATCH", `/users/${ids.admin}`, { disabled: true })).status, 409, "not yourself");

  // A second admin: then the first can step down (and back)
  assert.equal((await call("PATCH", `/users/${ids.old}`, { roleId: "admin" })).body.role.id, "admin");
  assert.equal((await call("PATCH", `/users/${ids.admin}`, { roleId: "member" }, "old")).body.role.id, "member");
  assert.equal((await call("PATCH", `/users/${ids.admin}`, { roleId: "admin" }, "old")).body.role.id, "admin");
  assert.equal((await call("PATCH", `/users/${ids.old}`, { roleId: "member" })).body.role.id, "member");

  // Disabling Ana: shut out, and every session she had ends (her old token too, once enabled again)
  await db.collection("oauth_refresh_tokens").insertOne({ userId: ids.ana, familyId: "f1", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) });
  await db.collection("sessions").insertOne({ userId: ids.ana, token: "old-github-session" });
  assert.equal((await call("PATCH", `/users/${ids.ana}`, { disabled: true })).body.disabled, true);
  clearAccessCache();
  const { accessFor } = await import("../src/access/access.js");
  const off = await accessFor(db, ids.ana, { env });
  assert.deepEqual([off.disabled, off.tokenVersion], [true, 1]);
  assert.ok((await db.collection("oauth_refresh_tokens").findOne({ userId: ids.ana })).revokedAt, "Deploy signed out");
  assert.equal(await db.collection("sessions").countDocuments({ userId: ids.ana }), 0, "GitHub's kept session gone");
  assert.equal((await call("PATCH", `/users/${ids.ana}`, { disabled: false })).body.disabled, false);

  // Sign out everywhere, on its own
  assert.equal((await call("POST", `/users/${ids.ana}/signout`)).status, 200);
  clearAccessCache();
  assert.equal((await accessFor(db, ids.ana, { env })).tokenVersion, 2);

  const changes = (await call("GET", "/changes")).body;
  assert.ok(changes.some((a) => a.type === "ADMIN_USER_UPDATED" && a.metadata.after.disabled === true && a.byEmail === "admin@x.test"), "disabling Ana is recorded, with who did it");
  assert.ok(changes.some((a) => a.type === "ADMIN_USER_SIGNED_OUT"));
  assert.ok(changes.some((a) => a.type === "ADMIN_ROLE_CREATED"));
  assert.ok(changes.some((a) => a.type === "ADMIN_ROLE_DELETED"));
});

test("admin: the owner — always an admin through GitHub sign-in (a verified address); an email sign-up with that address isn't; can't be demoted or disabled", { skip }, async () => {
  const owner = (await db.collection("users").insertOne({ email: "subratb920@gmail.com", githubId: 42, roleId: "member", disabled: true })).insertedId;
  const fake = (await db.collection("users").insertOne({ email: "subratb920@gmail.com.fake@x.test", passwordHash: "h" })).insertedId;
  assert.equal(await ensureOwners(db), 1);
  const o = await db.collection("users").findOne({ _id: owner });
  assert.deepEqual([o.roleId, o.disabled], ["admin", false]);
  assert.equal((await db.collection("users").findOne({ _id: fake })).roleId, undefined, "not the owner");
  // An email sign-up with the owner's address (in another database): no admin
  const other = client.db(`${db.databaseName}_owner`);
  await other.dropDatabase();
  const emailOnly = (await other.collection("users").insertOne({ email: "subratb920@gmail.com", passwordHash: "h" })).insertedId;
  assert.equal(await ensureOwners(other), 0);
  assert.equal((await other.collection("users").findOne({ _id: emailOnly })).roleId, undefined, "unverified: never the owner");
  await other.dropDatabase();

  const row = (await call("GET", `/users/${owner}`)).body;
  assert.deepEqual([row.owner, row.role.id], [true, "admin"]);
  assert.equal((await call("PATCH", `/users/${owner}`, { roleId: "member" })).body.code, "OWNER");
  assert.equal((await call("PATCH", `/users/${owner}`, { disabled: true })).body.code, "OWNER");
  await db.collection("users").deleteMany({ _id: { $in: [owner, fake] } });
});

test("admin: the first admin — no admin, a one-time code (kept across restarts until it expires), claimed once", { skip }, async () => {
  const fresh = client.db(`${db.databaseName}_first`);
  await fresh.dropDatabase();
  await ensureAccess(fresh);
  const u1 = (await fresh.collection("users").insertOne({ email: "first@x.test" })).insertedId;
  const u2 = (await fresh.collection("users").insertOne({ email: "second@x.test" })).insertedId;
  const made = await prepareAdminSetup(fresh);
  assert.match(made.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await prepareAdminSetup(fresh)).existing, true, "another start keeps the code already in a log");
  assert.equal(await adminSetupOpen(fresh), true);
  assert.equal(await claimAdmin(fresh, u2, "WRONG-CODE-0000"), false);
  assert.equal(await claimAdmin(fresh, u1, made.code.toLowerCase()), true, "any case, with or without dashes");
  assert.equal((await fresh.collection("users").findOne({ _id: u1 })).roleId, "admin");
  assert.equal(await claimAdmin(fresh, u2, made.code), false, "once");
  assert.equal(await adminSetupOpen(fresh), false);
  assert.equal(await prepareAdminSetup(fresh), null, "with an admin, no code");
  // Expired: refused
  await fresh.collection("users").updateOne({ _id: u1 }, { $set: { roleId: "member" } });
  const again = await prepareAdminSetup(fresh);
  assert.equal(await claimAdmin(fresh, u2, again.code, { now: new Date(Date.now() + 25 * 3_600_000) }), false, "after 24 hours");
  await fresh.dropDatabase();
});

test("admin: recent sign-ins across everyone, refused ones alone on request", { skip }, async () => {
  assert.equal((await call("GET", "/activity")).body.length, 2);
  assert.deepEqual((await call("GET", "/activity?failed=1")).body.map((l) => l.reason), ["wrong email or password"]);
});
