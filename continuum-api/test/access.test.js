import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ObjectId } from "mongodb";

// The middleware reads the server's settings when it loads
Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", PORT: "0", MONGO_URI: "mongodb://x", DB_NAME: "t", JWT_SECRET: "s".repeat(32), CLIENT_ORIGIN: "http://x" });
const { accessFor, clearAccessCache, ensureAccess, roleForNewUser, ADMIN_ROLE, MEMBER_ROLE } = await import("../src/access/access.js");
const { FEATURE_IDS, FEATURES, effectiveFeatures } = await import("../src/access/features.js");
const { requireFeature, requireFeatureByMethod, requireFeatureFor, withAccess } = await import("../src/middleware/access.js");
const { AGENTS_RULES, DATA_RULES } = await import("../src/access/rules.js");

/** Collections in memory: enough for findOne / updateOne(upsert) / createIndex by _id. */
function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      cols.set(name, {
        docs,
        findOne: async (q) => docs.get(String(q._id)) ?? null,
        // Enough of a query for the role upgrade: { field: value } and { field: { $ne: value } }
        find: (q = {}) => ({
          toArray: async () =>
            [...docs.values()].filter((d) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "$ne" in v ? d[k] !== v.$ne : d[k] === v))),
        }),
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

test("access: features come app by app; an app's sub-features count only while the app is on", () => {
  assert.deepEqual([...new Set(FEATURES.map((f) => f.app))], ["console", "agents", "data", "deploy"]);
  for (const f of FEATURES.filter((x) => x.parent)) assert.equal(FEATURES.find((x) => x.id === f.parent)?.app, f.app, `${f.id}'s parent opens its app`);
  assert.deepEqual(effectiveFeatures(["deploy_run", "data", "data_recipes", "nonsense"]), ["data", "data_recipes"], "deploy_run without deploy is off");
});

test("access: roles saved before the per-app features keep everything each app allowed (its new sub-features on), once", async () => {
  clearAccessCache();
  const db = fakeDb();
  await db.collection("roles").updateOne({ _id: "member" }, { $setOnInsert: { name: "Member", features: ["interval", "dashboard", "agents", "data", "workspaces", "create", "import_github", "publish", "deploy"] } }, { upsert: true });
  await db.collection("roles").updateOne({ _id: "viewer" }, { $setOnInsert: { name: "Viewer", features: ["dashboard", "data"] } }, { upsert: true });
  await ensureAccess(db);
  const roles = db.collection("roles").docs;
  assert.deepEqual(roles.get("viewer").features.sort(), ["dashboard", "data", "data_credentials", "data_publish", "data_recipes", "data_sources"].sort());
  assert.equal(roles.get("viewer").featureSet, 2);
  assert.deepEqual(roles.get("member").features.sort(), FEATURE_IDS.filter((f) => f !== "admin").sort());
  // An admin switches one off afterwards: it stays off
  roles.get("viewer").features = ["dashboard", "data"];
  await ensureAccess(db);
  assert.deepEqual(roles.get("viewer").features, ["dashboard", "data"]);
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
});
