import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { attachClient, cleanClient, createUsageTracker, historyDays, parseUserAgent, recordLogin } from "../src/access/activity.js";

/** Just enough of MongoDB for what activity.js writes. */
function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) {
      const docs = [];
      const match = (d, q) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && !(v instanceof ObjectId) && !(v instanceof Date) ? Object.entries(v).every(([op, x]) => (op === "$exists" ? (d[k] !== undefined) === x : op === "$gte" ? d[k] >= x : true)) : String(d[k]) === String(v)));
      cols.set(name, {
        docs,
        insertOne: async (d) => void docs.push({ _id: d._id ?? new ObjectId(), ...d }),
        updateOne: async (q, u) => {
          const d = docs.find((x) => match(x, q));
          if (!d) return;
          for (const [k, v] of Object.entries(u.$set ?? {})) {
            const [a, b] = k.split(".");
            if (b) d[a] = { ...(d[a] ?? {}), [b]: v };
            else d[k] = v;
          }
        },
        find: (q) => {
          let list = docs.filter((d) => match(d, q));
          const cur = { sort: (s) => ((list = [...list].sort((a, b) => (s.at === -1 ? b.at - a.at : a.at - b.at))), cur), limit: (n) => ((list = list.slice(0, n)), cur), next: async () => list[0] ?? null };
          return cur;
        },
        bulkWrite: async (ops) => {
          for (const { updateOne: { filter, update, upsert } } of ops) {
            let d = docs.find((x) => match(x, filter));
            if (!d && upsert) docs.push((d = { ...filter, ...(update.$setOnInsert ?? {}) }));
            if (!d) continue;
            for (const [k, v] of Object.entries(update.$inc ?? {})) d[k] = (d[k] ?? 0) + v;
            for (const [k, v] of Object.entries(update.$min ?? {})) d[k] = d[k] && d[k] < v ? d[k] : v;
            for (const [k, v] of Object.entries(update.$max ?? {})) d[k] = d[k] && d[k] > v ? d[k] : v;
          }
        },
      });
    }
    return cols.get(name);
  };
  return { collection: col };
}

const req = (headers = {}, ip = "203.0.113.7") => ({ ip, get: (h) => headers[h.toLowerCase()] });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("activity: browser, system and kind of device from the User-Agent", () => {
  assert.deepEqual(parseUserAgent(IPHONE), { browser: "Safari 17.4", os: "iOS 17.4", device: "phone" });
  assert.deepEqual(parseUserAgent(MAC_CHROME), { browser: "Chrome 131.0", os: "macOS 10.15", device: "desktop" });
  assert.equal(parseUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36").device, "tablet");
  assert.equal(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131.0.0.0").browser, "Edge 131.0");
  assert.deepEqual(parseUserAgent(""), { browser: null, os: null, device: null });
  assert.deepEqual(parseUserAgent("curl/8.5.0"), { browser: "curl 8.5", os: null, device: "program" }, "a program isn't a device");
});

test("activity: a sign-in is recorded with where and on what; a good one updates the user's last sign-in and device", async () => {
  const db = fakeDb();
  const userId = new ObjectId();
  await db.collection("users").insertOne({ _id: userId, email: "a@x.test" });
  const now = new Date("2026-10-17T10:00:00Z");
  const doc = await recordLogin(db, { userId, email: "A@x.test", method: "github", req: req({ "user-agent": IPHONE, "x-client-region": "IN" }), now, env: {} });
  assert.deepEqual([doc.email, doc.method, doc.ok, doc.ip, doc.browser, doc.os, doc.device, doc.region], ["a@x.test", "github", true, "203.0.113.7", "Safari 17.4", "iOS 17.4", "phone", "IN"]);
  assert.equal(doc.expireAt.getTime() - now.getTime(), 180 * 86_400_000, "kept 180 days unless set");
  const u = db.collection("users").docs[0];
  assert.deepEqual([u.lastLoginMethod, u.lastLoginAt, u.lastSeenAt, u.lastDevice.device, u.lastDevice.ip], ["github", now, now, "phone", "203.0.113.7"]);

  // A refused one: recorded, the user unchanged
  await recordLogin(db, { email: "a@x.test", method: "email", ok: false, reason: "wrong email or password", req: req({ "user-agent": MAC_CHROME }, "198.51.100.9"), env: { LOGIN_HISTORY_DAYS: "30" } });
  const failed = db.collection("login_events").docs.at(-1);
  assert.deepEqual([failed.ok, failed.reason, failed.userId, failed.device], [false, "wrong email or password", null, "desktop"]);
  assert.equal(u.lastLoginMethod, "github");
  assert.equal(historyDays({ LOGIN_HISTORY_DAYS: "30" }), 30);
});

test("activity: the browser's own details join its sign-in (of the last 15 minutes) and the user's last device; anything else is dropped", async () => {
  const db = fakeDb();
  const userId = new ObjectId();
  await db.collection("users").insertOne({ _id: userId, email: "a@x.test" });
  const at = new Date("2026-10-17T10:00:00Z");
  await recordLogin(db, { userId, email: "a@x.test", method: "email", req: req({ "user-agent": MAC_CHROME }), now: at, env: {} });
  assert.deepEqual(cleanClient({ platform: "macOS", screen: "1512×982@2x", timezone: "Asia/Kolkata", touch: false, cores: 11, password: "nope", evil: { x: 1 } }), { platform: "macOS", screen: "1512×982@2x", timezone: "Asia/Kolkata", touch: false, cores: 11 });
  assert.equal(await attachClient(db, userId, { timezone: "Asia/Kolkata", language: "en-IN" }, { now: new Date(at.getTime() + 60_000) }), true);
  assert.deepEqual(db.collection("login_events").docs[0].client, { timezone: "Asia/Kolkata", language: "en-IN" });
  assert.equal(db.collection("users").docs[0].lastDevice.client.language, "en-IN");
  assert.equal(await attachClient(db, userId, { language: "fr" }, { now: new Date(at.getTime() + 60_000) }), false, "that sign-in has its details already");
  assert.equal(await attachClient(db, userId, {}), false, "nothing to add");
});

test("activity: app use is counted in memory and written once (per user, app and day), with last seen", async () => {
  const db = fakeDb();
  const a = new ObjectId();
  const b = new ObjectId();
  await db.collection("users").insertOne({ _id: a });
  let t = new Date("2026-10-17T09:00:00Z");
  const usage = createUsageTracker(() => db, { flushMs: 60_000, env: {}, now: () => t });
  usage.used(a, "agents");
  t = new Date("2026-10-17T09:05:00Z");
  usage.used(a, "agents");
  usage.used(a, "workspaces");
  usage.used(b, "agents");
  usage.sawUser(a);
  usage.used(null, "agents"); // nobody: not counted
  assert.equal(usage.pending(), 4);
  assert.deepEqual(await usage.flush(), { uses: 3, seen: 1 });
  const rows = db.collection("app_usage").docs;
  const agentsA = rows.find((r) => String(r.userId) === String(a) && r.app === "agents");
  assert.deepEqual([agentsA.day, agentsA.count, agentsA.firstAt.toISOString(), agentsA.lastAt.toISOString()], ["2026-10-17", 2, "2026-10-17T09:00:00.000Z", "2026-10-17T09:05:00.000Z"]);
  assert.equal(rows.length, 3);
  assert.equal(db.collection("users").docs[0].lastSeenAt.toISOString(), "2026-10-17T09:05:00.000Z");
  // The next minute adds to the same day's row
  usage.used(a, "agents");
  await usage.flush();
  assert.equal(db.collection("app_usage").docs.find((r) => String(r.userId) === String(a) && r.app === "agents").count, 3);
  assert.equal(usage.pending(), 0);
});
