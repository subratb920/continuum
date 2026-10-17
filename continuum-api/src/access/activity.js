// src/access/activity.js
//
// What admins see about people using Continuum: each sign-in (email, GitHub,
// Continuum Deploy; failed email sign-ins too) with when, how, from where and
// on what device; which apps each person uses, per day; and on each user their
// last sign-in, last seen and last device. Kept LOGIN_HISTORY_DAYS (180 unless
// set), then removed by MongoDB itself (expireAt). Admins only see it.

const DAY_MS = 86_400_000;

export const historyDays = (env = process.env) => {
  const n = Number(env.LOGIN_HISTORY_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 180;
};

/** Indexes: newest first per user and overall, and expiry. Safe on every start. */
export async function ensureActivity(db) {
  await db.collection("login_events").createIndexes([
    { key: { userId: 1, at: -1 }, name: "user_at" },
    { key: { at: -1 }, name: "at" },
    { key: { expireAt: 1 }, name: "expire_at", expireAfterSeconds: 0 },
  ]);
  await db.collection("app_usage").createIndexes([
    { key: { userId: 1, day: -1 }, name: "user_day" },
    { key: { app: 1, day: -1 }, name: "app_day" },
    { key: { expireAt: 1 }, name: "expire_at", expireAfterSeconds: 0 },
  ]);
}

/**
 * Browser, operating system and kind of device from a User-Agent (enough to
 * tell them apart; not a fingerprint).
 */
export function parseUserAgent(ua = "") {
  const s = String(ua);
  const pick = (rules) => {
    for (const [re, name, ver] of rules) {
      const m = re.exec(s);
      if (m) return ver && m[ver] ? `${name} ${m[ver].split(/[._]/).slice(0, 2).join(".")}` : name;
    }
    return null;
  };
  const browser = pick([
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge", 1],
    [/OPR\/([\d.]+)/, "Opera", 1],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet", 1],
    [/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome", 1],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, "Firefox", 1],
    [/Version\/([\d.]+).*Safari/, "Safari", 1],
    [/curl\/([\d.]+)/, "curl", 1],
    [/node|undici|axios|python-requests|Go-http-client/i, "a program"],
  ]);
  const os = pick([
    [/iPhone OS ([\d_]+)/, "iOS", 1],
    [/iPad.*OS ([\d_]+)/, "iPadOS", 1],
    [/Android ([\d.]+)/, "Android", 1],
    [/Windows NT 10/, "Windows 10/11"],
    [/Windows NT ([\d.]+)/, "Windows", 1],
    [/Mac OS X ([\d_]+)/, "macOS", 1],
    [/CrOS/, "ChromeOS"],
    [/Linux/, "Linux"],
  ]);
  const device = /bot|crawler|spider/i.test(s)
    ? "bot"
    : browser === "a program" || /^curl /.test(browser ?? "")
      ? "program"
    : /iPad|Tablet|Android(?!.*Mobile)/.test(s)
      ? "tablet"
      : /Mobi|iPhone|Android/.test(s)
        ? "phone"
        : s
          ? "desktop"
          : null;
  return { browser, os, device };
}

/** Where a request came from: its address (behind a proxy, TRUST_PROXY must be set) and the region if the load balancer says. */
export function origin(req) {
  const ua = req.get?.("user-agent") ?? "";
  return {
    ip: req.ip ?? null,
    userAgent: ua.slice(0, 400) || null,
    ...parseUserAgent(ua),
    // Google's load balancer can add these (custom request headers on the backend)
    region: req.get?.("x-client-region") || null,
    city: req.get?.("x-client-city") || null,
  };
}

/**
 * A sign-in: method email | github | deploy (signing in to Continuum Deploy);
 * ok false for a refused one (reason). A good one also updates the user's
 * last sign-in, last seen and last device.
 */
export async function recordLogin(db, { userId = null, email = null, method, ok = true, reason = null, signup = false, req, now = new Date(), env = process.env }) {
  const from = origin(req);
  const doc = {
    userId,
    email: email ? String(email).toLowerCase() : null,
    method,
    ok,
    ...(reason ? { reason } : {}),
    ...(signup ? { signup: true } : {}),
    at: now,
    ...from,
    expireAt: new Date(now.getTime() + historyDays(env) * DAY_MS),
  };
  await db.collection("login_events").insertOne(doc);
  if (ok && userId) {
    const device = { ip: from.ip, browser: from.browser, os: from.os, device: from.device, region: from.region, at: now };
    await db.collection("users").updateOne(
      { _id: userId },
      { $set: { lastLoginAt: now, lastLoginMethod: method, lastSeenAt: now, lastDevice: device } }
    );
  }
  return doc;
}

const CLIENT_KEYS = ["platform", "screen", "timezone", "language", "touch", "memory", "cores"];

/** What the browser says about itself after a sign-in, kept short. */
export function cleanClient(body) {
  const out = {};
  for (const k of CLIENT_KEYS) {
    const v = body?.[k];
    if (typeof v === "string" && v) out[k] = v.slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * The browser's own details (screen, time zone, language…), added to this
 * user's latest sign-in (of the last 15 minutes, without them yet) and to
 * their last device.
 */
export async function attachClient(db, userId, body, { now = new Date() } = {}) {
  const client = cleanClient(body);
  if (!Object.keys(client).length) return false;
  const latest = await db
    .collection("login_events")
    .find({ userId, ok: true, client: { $exists: false }, at: { $gte: new Date(now.getTime() - 15 * 60_000) } })
    .sort({ at: -1 })
    .limit(1)
    .next();
  if (latest) await db.collection("login_events").updateOne({ _id: latest._id }, { $set: { client } });
  await db.collection("users").updateOne({ _id: userId }, { $set: { "lastDevice.client": client } });
  return !!latest;
}

const dayOf = (d) => d.toISOString().slice(0, 10);

/**
 * App use, counted in memory and written once a minute (not on every
 * request): per user, app and day, how many requests, the first and the last.
 * Also each user's last seen.
 */
export function createUsageTracker(getDb, { flushMs = 60_000, env = process.env, now = () => new Date() } = {}) {
  const uses = new Map(); // "userId|app|day" → { userId, app, day, count, first, last }
  const seen = new Map(); // userId → last
  let timer = null;

  const schedule = () => {
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flush().catch(() => {}); // the next minute tries again with what's new
      }, flushMs);
      timer.unref?.();
    }
  };

  function used(userId, app) {
    if (!userId || !app) return;
    const t = now();
    const key = `${userId}|${app}|${dayOf(t)}`;
    const u = uses.get(key) ?? { userId, app, day: dayOf(t), count: 0, first: t, last: t };
    u.count++;
    u.last = t;
    uses.set(key, u);
    schedule();
  }

  function sawUser(userId) {
    if (!userId) return;
    seen.set(String(userId), { userId, at: now() });
    schedule();
  }

  async function flush() {
    const db = getDb();
    const batch = [...uses.values()];
    const people = [...seen.values()];
    uses.clear();
    seen.clear();
    if (batch.length) {
      const keep = historyDays(env) * DAY_MS;
      await db.collection("app_usage").bulkWrite(
        batch.map((u) => ({
          updateOne: {
            filter: { _id: `${u.userId}:${u.app}:${u.day}` },
            update: {
              $inc: { count: u.count },
              $min: { firstAt: u.first },
              $max: { lastAt: u.last },
              $setOnInsert: { userId: u.userId, app: u.app, day: u.day, expireAt: new Date(Date.parse(u.day) + keep) },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }
    if (people.length) {
      await db.collection("users").bulkWrite(
        people.map((p) => ({ updateOne: { filter: { _id: p.userId }, update: { $max: { lastSeenAt: p.at } } } })),
        { ordered: false }
      );
    }
    return { uses: batch.length, seen: people.length };
  }

  return { used, sawUser, flush, pending: () => uses.size + seen.size };
}
