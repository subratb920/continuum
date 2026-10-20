// continuum-directory/server/src/activity.js
//
// What admins see about users of Continuum: each sign-in (email, GitHub,
// Continuum Deploy, the Directory; failed email sign-ins too) with when, how,
// from where, over what network (as the request and Google's load balancer
// report it; nobody else is asked) and on what device; which apps each user
// uses, per day; and on each user their last sign-in, last seen and last
// device. Kept historyDays (180 unless set), then removed by sweep(). Admins
// only see it.

const DAY_MS = 86_400_000;

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

const short = (v, n = 80) => (typeof v === "string" && v ? v.slice(0, n) : null);
const num = (v) => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The network a request came over, from the request itself: IPv4 or IPv6, the
 * chain of addresses proxies passed on (X-Forwarded-For, as reported: the
 * first can be made up by the client), the protocol and HTTP version; and,
 * when the app's load balancer adds them ("clientInfo" in continuum.deploy.json),
 * Google's view of the client: its country, area and city (with the city's
 * position, not the device's), round-trip time and TLS.
 */
export function networkOf(req) {
  const g = (h) => short(req.get?.(h) ?? null);
  const ip = req.ip ?? null;
  const chain = String(req.get?.("x-forwarded-for") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
  const latLong = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(g("x-client-lat-long") ?? "") ? g("x-client-lat-long") : null;
  const out = {
    ipVersion: ip ? (ip.includes(":") && !ip.startsWith("::ffff:") ? 6 : 4) : null,
    forwardedFor: chain.length ? chain : null,
    protocol: short(req.protocol ?? null, 10),
    httpVersion: short(req.httpVersion ?? null, 10),
    via: g("via"),
    subdivision: g("x-client-subdivision"),
    cityLatLong: latLong,
    rttMs: num(g("x-client-rtt")),
    tlsVersion: g("x-client-tls"),
    tlsCipher: g("x-client-cipher"),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

/** Where a request came from: its address (behind a proxy, TRUST_PROXY must be set), the network, and the region if the load balancer says. */
export function origin(req) {
  const ua = req.get?.("user-agent") ?? "";
  return {
    ip: req.ip ?? null,
    userAgent: ua.slice(0, 400) || null,
    ...parseUserAgent(ua),
    // Google's load balancer adds these when asked (custom request headers)
    region: req.get?.("x-client-region") || null,
    city: req.get?.("x-client-city") || null,
    network: networkOf(req),
  };
}

// What the browser says about itself and its network (the Network Information API, where it has one)
const CLIENT_KEYS = ["platform", "screen", "timezone", "language", "touch", "memory", "cores", "netType", "netEffective", "netDownlinkMbps", "netRttMs", "netSaveData"];

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

const dayOf = (d) => d.toISOString().slice(0, 10);

export function createActivity({ pool, cfg }) {
  const q = (sql, params) => pool.query(sql, params);
  const keepMs = () => cfg.historyDays * DAY_MS;

  /**
   * A sign-in: method email | github | deploy | directory; ok false for a
   * refused one (reason). A good one also updates the user's last sign-in,
   * last seen and last device.
   */
  async function recordLogin({ userId = null, email = null, method, ok = true, reason = null, signup = false, req, now = new Date() }) {
    const from = origin(req);
    const doc = {
      userId: userId ? String(userId) : null,
      email: email ? String(email).toLowerCase() : null,
      method,
      ok,
      ...(reason ? { reason } : {}),
      ...(signup ? { signup: true } : {}),
      at: now,
      ...from,
      expireAt: new Date(now.getTime() + keepMs()),
    };
    await q(
      `INSERT INTO login_events (user_id, email, method, ok, reason, signup, at, ip, user_agent, browser, os, device, region, city, network, expire_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [doc.userId, doc.email, method, ok, reason, signup, now, from.ip, from.userAgent, from.browser, from.os, from.device, from.region, from.city, from.network, doc.expireAt]
    );
    if (ok && userId) {
      const device = { ip: from.ip, browser: from.browser, os: from.os, device: from.device, region: from.region, city: from.city, network: from.network, at: now };
      await q(`UPDATE users SET last_login_at = $2, last_login_method = $3, last_seen_at = GREATEST(last_seen_at, $2), last_device = $4 WHERE id = $1`, [String(userId), now, method, device]);
    }
    return doc;
  }

  /**
   * The browser's own details (screen, time zone, language…), added to this
   * user's latest sign-in (of the last 15 minutes, without them yet) and to
   * their last device.
   */
  async function attachClient(userId, body, { now = new Date() } = {}) {
    const client = cleanClient(body);
    if (!Object.keys(client).length) return false;
    const r = await q(
      `UPDATE login_events SET client = $2 WHERE id = (
         SELECT id FROM login_events WHERE user_id = $1 AND ok AND client IS NULL AND at >= $3 ORDER BY at DESC LIMIT 1)`,
      [String(userId), client, new Date(now.getTime() - 15 * 60_000)]
    );
    await q(`UPDATE users SET last_device = jsonb_set(COALESCE(last_device, '{}'::jsonb), '{client}', $2) WHERE id = $1`, [String(userId), client]);
    return r.rowCount > 0;
  }

  /**
   * App use, counted in memory and written once a minute (not on every
   * request): per user, app and day, how many requests, the first and the
   * last. Also each user's last seen.
   */
  function createUsageTracker({ flushMs = 60_000, now = () => new Date() } = {}) {
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
      const u = uses.get(key) ?? { userId: String(userId), app, day: dayOf(t), count: 0, first: t, last: t };
      u.count++;
      u.last = t;
      uses.set(key, u);
      schedule();
    }

    function sawUser(userId) {
      if (!userId) return;
      seen.set(String(userId), now());
      schedule();
    }

    async function flush() {
      const batch = [...uses.values()];
      const people = [...seen.entries()];
      uses.clear();
      seen.clear();
      for (const u of batch) {
        await q(
          `INSERT INTO app_usage (user_id, app, day, count, first_at, last_at, expire_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, app, day) DO UPDATE SET count = app_usage.count + EXCLUDED.count,
             first_at = LEAST(app_usage.first_at, EXCLUDED.first_at), last_at = GREATEST(app_usage.last_at, EXCLUDED.last_at)`,
          [u.userId, u.app, u.day, u.count, u.first, u.last, new Date(Date.parse(u.day) + keepMs())]
        );
      }
      for (const [userId, at] of people) {
        await q(`UPDATE users SET last_seen_at = GREATEST(last_seen_at, $2) WHERE id = $1`, [userId, at]);
      }
      return { uses: batch.length, seen: people.length };
    }

    return { used, sawUser, flush, pending: () => uses.size + seen.size };
  }

  /** Sign-ins and app use past their days go (Postgres keeps them otherwise). */
  async function sweep(now = new Date()) {
    const a = await q(`DELETE FROM login_events WHERE expire_at <= $1`, [now]);
    const b = await q(`DELETE FROM app_usage WHERE expire_at <= $1`, [now]);
    return { loginEvents: a.rowCount, appUsage: b.rowCount };
  }

  /** One user's app use (for moving an account between Continuums). */
  async function exportUsage(userId) {
    return (await q(`SELECT app, day, count, first_at, last_at FROM app_usage WHERE user_id = $1`, [String(userId)])).rows.map((r) => ({ app: r.app, day: r.day, count: r.count, firstAt: r.first_at, lastAt: r.last_at }));
  }

  /** App use from another Continuum, added (a day already counted here keeps its own). */
  async function importUsage(userId, rows = []) {
    let added = 0;
    for (const r of rows) {
      if (typeof r?.app !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.day))) continue;
      const res = await q(
        `INSERT INTO app_usage (user_id, app, day, count, first_at, last_at, expire_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [String(userId), r.app.slice(0, 40), r.day, Number(r.count) || 0, r.firstAt ?? null, r.lastAt ?? null, new Date(Date.parse(r.day) + keepMs())]
      );
      added += res.rowCount;
    }
    return { added, kept: rows.length - added };
  }

  return { recordLogin, attachClient, createUsageTracker, sweep, exportUsage, importUsage };
}
