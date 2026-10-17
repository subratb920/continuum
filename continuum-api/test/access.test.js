import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ObjectId } from "mongodb";

// The middleware reads the server's settings when it loads
Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", PORT: "0", MONGO_URI: "mongodb://x", DB_NAME: "t", JWT_SECRET: "s".repeat(32), CLIENT_ORIGIN: "http://x" });
const { accessFor, clearAccessCache, ensureAccess, roleForNewUser, ADMIN_ROLE, MEMBER_ROLE } = await import("../src/access/access.js");
const { FEATURE_IDS } = await import("../src/access/features.js");
const { requireFeature, requireFeatureByMethod, withAccess } = await import("../src/middleware/access.js");

/** Collections in memory: enough for findOne / updateOne(upsert) / createIndex by _id. */
function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      cols.set(name, {
        docs,
        findOne: async (q) => docs.get(String(q._id)) ?? null,
        updateOne: async (q, u, o) => {
          const k = String(q._id);
          if (!docs.has(k) && o?.upsert) docs.set(k, { _id: q._id, ...(u.$setOnInsert ?? {}) });
          if (docs.has(k) && u.$set) Object.assign(docs.get(k), u.$set);
        },
        createIndex: async () => {},
      });
    }
    return cols.get(name);
  };
  return { collection: col };
}

async function setup() {
  clearAccessCache();
  const db = fakeDb();
  await ensureAccess(db);
  const user = (fields) => {
    const _id = new ObjectId();
    db.collection("users").docs.set(String(_id), { _id, email: `${_id}@x.test`, ...fields });
    return _id;
  };
  return { db, user };
}

const env = {};

test("access: users from before roles are members (everything but admin); a role's features are what it switches on", async () => {
  const { db, user } = await setup();
  const old = await accessFor(db, user({}), { env });
  assert.equal(old.role.id, MEMBER_ROLE);
  assert.deepEqual(old.features, FEATURE_IDS.filter((f) => f !== "admin"));
  assert.equal(old.isAdmin, false);

  await db.collection("roles").updateOne({ _id: "viewer" }, { $setOnInsert: { name: "Viewer", features: ["dashboard", "interval", "nonsense"] } }, { upsert: true });
  const viewer = await accessFor(db, user({ roleId: "viewer" }), { env });
  assert.deepEqual([viewer.role.name, viewer.features], ["Viewer", ["interval", "dashboard"]], "only known features, in order");

  // A role that's gone: a member again (never more than that)
  const orphan = await accessFor(db, user({ roleId: "deleted-role" }), { env });
  assert.equal(orphan.role.id, MEMBER_ROLE);
  assert.equal(await accessFor(db, new ObjectId(), { env }), null, "no such user");
});

test("access: only the admin role makes an admin (nothing outside the database does), and admin always has every feature", async () => {
  const { db, user } = await setup();
  process.env.ADMIN_EMAILS = "boss@example.com"; // a setting like this means nothing
  const boss = await accessFor(db, user({ email: "boss@example.com", roleId: "viewer" }), { env });
  delete process.env.ADMIN_EMAILS;
  assert.equal(boss.isAdmin, false);
  const admin = await accessFor(db, user({ roleId: ADMIN_ROLE }), { env });
  assert.deepEqual([admin.role.id, admin.isAdmin, admin.features], [ADMIN_ROLE, true, FEATURE_IDS]);
  // Even if the admin role's document were edited down
  await db.collection("roles").updateOne({ _id: ADMIN_ROLE }, { $set: { features: ["dashboard"] } });
  clearAccessCache();
  assert.deepEqual((await accessFor(db, user({ roleId: ADMIN_ROLE }), { env })).features, FEATURE_IDS);
  assert.equal((await accessFor(db, user({ email: "someone@example.com" }), { env })).isAdmin, false);
});

test("access: new users get the default role; a missing default falls back to member", async () => {
  const { db } = await setup();
  assert.equal(await roleForNewUser(db), MEMBER_ROLE);
  await db.collection("roles").updateOne({ _id: "starter" }, { $setOnInsert: { name: "Starter", features: ["dashboard"] } }, { upsert: true });
  await db.collection("settings").updateOne({ _id: "access" }, { $set: { defaultRoleId: "starter" } });
  assert.equal(await roleForNewUser(db), "starter");
  await db.collection("settings").updateOne({ _id: "access" }, { $set: { defaultRoleId: "gone" } });
  assert.equal(await roleForNewUser(db), MEMBER_ROLE);
});

test("access: cached for a minute, cleared at once by the copy that changes it", async () => {
  const { db, user } = await setup();
  const id = user({});
  assert.equal((await accessFor(db, id, { env, now: 0 })).role.id, MEMBER_ROLE);
  db.collection("users").docs.get(String(id)).disabled = true;
  assert.equal((await accessFor(db, id, { env, now: 30_000 })).disabled, false, "cached");
  assert.equal((await accessFor(db, id, { env, now: 61_000 })).disabled, true, "a minute later");
  db.collection("users").docs.get(String(id)).disabled = false;
  clearAccessCache(id);
  assert.equal((await accessFor(db, id, { env, now: 62_000 })).disabled, false, "cleared");
});

test("access: a feature switched off answers 403 No feature access; reading and changing can need different features; disabled accounts get nothing; old sessions end", async () => {
  const { db, user } = await setup();
  await db.collection("roles").updateOne({ _id: "viewer" }, { $setOnInsert: { name: "Viewer", features: ["dashboard"] } }, { upsert: true });
  const ids = { viewer: user({ roleId: "viewer" }), member: user({}), off: user({ disabled: true }), outdated: user({ tokenVersion: 1 }) };

  const app = express();
  // Tokens carry the session version they were made with (here 0: before any "sign out everywhere")
  app.use((req, _res, next) => ((req.user = { id: ids[req.get("x-who")], tv: 0 }), next()));
  app.use(withAccess({ db: () => db, env }));
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
    assert.match(body.error, /^No feature access: Agents isn't switched on for your role/);
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
