// continuum-directory/server/src/activity.js
//
// What admins see about users of Continuum: each sign-in (email, GitHub,
// Continuum Deploy, the Directory; failed email sign-ins too) with when, how,
// from where, over what network (as the request and Google's load balancer
// report it; nobody else is asked) and on what device; which apps each user
// uses, per day; and on each user their last sign-in, last seen and last
// device. Kept historyDays (180 unless set), then removed by sweep(). Admins
// only see it.

import { createHash, randomBytes } from "node:crypto";

const DAY_MS = 86_400_000;

// A per-process fallback salt, used only when no DIRECTORY_HASH_SECRET is set.
const PROC_SALT = randomBytes(16).toString("hex");

/** A short, day-scoped hash (so visitors can be de-duped within a day but not linked across days). */
function dailyHash(secret, day, ...parts) {
  return createHash("sha256").update(`${secret}:${day}:${parts.join("|")}`).digest("hex").slice(0, 32);
}

/** A short, stable hash (no day): for a persistent id the visitor agreed to, so they can be followed across days. */
function stableHash(secret, ...parts) {
  return createHash("sha256").update(`${secret}:pid:${parts.join("|")}`).digest("hex").slice(0, 32);
}

/** A whole number clamped to a range (for untrusted engagement numbers). */
const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

const SEARCH_HOSTS = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave|startpage|qwant)\./i;
const SOCIAL_HOSTS = /(^|\.)(t\.co|twitter|x\.com|facebook|fb\.com|fb\.me|linkedin|lnkd\.in|reddit|youtube|instagram|pinterest|t\.me|whatsapp|news\.ycombinator|github)\b/i;

/** The host a referrer came from (no www), or null for none/unparseable. */
export function refererHost(referer) {
  if (!referer) return null;
  try {
    return new URL(String(referer)).hostname.replace(/^www\./, "").slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** Where a visit came from: direct (none or same site), search, social, or another site. */
export function visitSource(refHost, selfHost) {
  if (!refHost) return "direct";
  const self = String(selfHost ?? "").replace(/^www\./, "").toLowerCase();
  if (self && refHost.toLowerCase() === self) return "direct";
  if (SEARCH_HOSTS.test(refHost)) return "search";
  if (SOCIAL_HOSTS.test(refHost)) return "social";
  return "referral";
}

/** A request path on its own: no host, query or fragment; capped. */
export function cleanPath(p) {
  let s = String(p ?? "");
  if (!s.startsWith("/")) {
    try {
      s = new URL(s).pathname;
    } catch {
      return null;
    }
  }
  s = s.split(/[?#]/)[0];
  if (!s) return null;
  return s.slice(0, 200);
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

  /**
   * A public-site page view — the anonymous sibling of a sign-in. Nobody is
   * identified: the IP is used only to derive a daily-salted hash (rough daily
   * uniques, not linkable across days) and is never stored. `via` is 'server'
   * (every request, forwarded by continuum-site) or 'client' (an enrichment
   * beacon from a real browser). Coarse geo (region/city) only when the load
   * balancer passes it. Returns null for a path we won't record.
   */
  async function recordVisit(v = {}, now = new Date()) {
    const path = cleanPath(v.path);
    if (!path) return null;
    const ua = String(v.userAgent ?? "");
    const { browser, os, device } = parseUserAgent(ua);
    const bot = device === "bot" || device === "program";
    const refHost = refererHost(v.referer);
    const source = visitSource(refHost, v.host);
    const day = dayOf(now);
    const secret = cfg.hashSecret || PROC_SALT;
    const ip = v.ip ? String(v.ip) : null;
    const via = v.via === "client" ? "client" : "server";
    const network = v.network && typeof v.network === "object" && Object.keys(v.network).length ? v.network : null;
    const viewId = typeof v.viewId === "string" && /^[\w-]{8,64}$/.test(v.viewId) ? v.viewId : null;
    const pid = typeof v.pid === "string" && /^[\w-]{8,64}$/.test(v.pid) ? v.pid : null;
    await q(
      `INSERT INTO page_views (at, day, path, referer_host, source, via, browser, os, device, bot, region, city, ip_hash, visitor_hash, visitor_pid, view_id, network, client, expire_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [now, day, path, refHost, source, via, browser, os, device, bot, short(v.region, 12), short(v.city, 80),
       ip ? dailyHash(secret, day, ip) : null, ip ? dailyHash(secret, day, ip, ua) : null,
       pid ? stableHash(secret, pid) : null, viewId, network,
       v.client ? cleanClient(v.client) : null, new Date(now.getTime() + keepMs())]
    );
    return { path, source, bot, via };
  }

  /**
   * How a page view went: time on the page and how far down it was read,
   * reported by the browser when it leaves. Found by the browser-made view_id;
   * only a real-browser (client) view has one. Kept to the larger of what's
   * already there (a page can report more than once).
   */
  async function recordEngagement({ viewId, dwellMs, scrollPct } = {}) {
    if (typeof viewId !== "string" || !/^[\w-]{8,64}$/.test(viewId)) return false;
    const dwell = clampInt(dwellMs, 0, 24 * 3600_000); // at most a day
    const scroll = clampInt(scrollPct, 0, 100);
    if (dwell === null && scroll === null) return false;
    const r = await q(
      `UPDATE page_views SET dwell_ms = GREATEST(COALESCE(dwell_ms, 0), COALESCE($2, 0)),
                             scroll_pct = GREATEST(COALESCE(scroll_pct, 0), COALESCE($3, 0))
       WHERE view_id = $1 AND via = 'client'`,
      [viewId, dwell, scroll]
    );
    return r.rowCount > 0;
  }

  /**
   * Visitor analytics over a window (default: the last 30 days): totals and
   * unique estimate, per-day series, top pages, where they came from, countries,
   * devices and browsers. Humans only for the breakdowns (bots counted apart).
   */
  async function visitStats({ from, to } = {}) {
    const toD = to ? new Date(to) : new Date();
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 30 * DAY_MS);
    const params = [fromD, toD];
    const win = `at >= $1 AND at <= $2`;
    // Human page views are the real-browser (client) ones, so server-side rows for
    // the same view don't double-count. Each visitor is their persistent id when
    // they've consented, else their day-scoped hash.
    const human = `${win} AND NOT bot AND via = 'client'`;
    const vkey = `COALESCE(visitor_pid, visitor_hash)`;
    const [totals, series, pages, sources, countries, devices, browsers, recent] = await Promise.all([
      q(`SELECT count(*) FILTER (WHERE NOT bot AND via = 'client')::int AS views,
                count(DISTINCT ${vkey}) FILTER (WHERE NOT bot AND via = 'client')::int AS visitors,
                count(*) FILTER (WHERE bot)::int AS bots,
                count(*) FILTER (WHERE via = 'server' AND NOT bot)::int AS requests
         FROM page_views WHERE ${win}`, params),
      q(`SELECT day, count(*)::int AS views, count(DISTINCT visitor_hash)::int AS visitors
         FROM page_views WHERE ${human} GROUP BY day ORDER BY day`, params),
      q(`SELECT path, count(*)::int AS views FROM page_views WHERE ${human} GROUP BY path ORDER BY views DESC, path LIMIT 20`, params),
      q(`SELECT source, count(*)::int AS views FROM page_views WHERE ${human} GROUP BY source ORDER BY views DESC`, params),
      q(`SELECT COALESCE(NULLIF(region, ''), '—') AS country, count(*)::int AS views FROM page_views WHERE ${human} GROUP BY 1 ORDER BY views DESC LIMIT 20`, params),
      q(`SELECT COALESCE(device, '—') AS device, count(*)::int AS views FROM page_views WHERE ${human} GROUP BY 1 ORDER BY views DESC`, params),
      q(`SELECT COALESCE(browser, '—') AS browser, count(*)::int AS views FROM page_views WHERE ${human} GROUP BY 1 ORDER BY views DESC LIMIT 12`, params),
      q(`SELECT id, at, path, source, via, bot, browser, os, device, region, city, network, client
         FROM page_views WHERE ${win} ORDER BY at DESC LIMIT 100`, params),
    ]);
    const t = totals.rows[0] ?? { views: 0, visitors: 0, bots: 0, requests: 0 };
    return {
      from: fromD,
      to: toD,
      views: t.views,
      visitors: t.visitors,
      bots: t.bots,
      requests: t.requests,
      perDay: series.rows.map((r) => ({ day: r.day, views: r.views, visitors: r.visitors })),
      topPages: pages.rows.map((r) => ({ path: r.path, views: r.views })),
      sources: sources.rows.map((r) => ({ source: r.source, views: r.views })),
      countries: countries.rows.map((r) => ({ country: r.country, views: r.views })),
      devices: devices.rows.map((r) => ({ device: r.device, views: r.views })),
      browsers: browsers.rows.map((r) => ({ browser: r.browser, views: r.views })),
      recent: recent.rows.map((r) => ({
        id: String(r.id),
        at: r.at,
        path: r.path,
        source: r.source,
        via: r.via,
        bot: r.bot,
        browser: r.browser,
        os: r.os,
        device: r.device,
        region: r.region,
        city: r.city,
        network: r.network,
        ...(r.client ? { client: r.client } : {}),
      })),
    };
  }

  /**
   * Visitor journeys: each anonymous visitor's topics over the window, the most
   * engaged first. A visitor is their consented persistent id (followed across
   * days) or, without consent, their day-scoped hash (so "a visitor" there means
   * within one day). Per topic: views, time spent and how far they read.
   */
  async function visitorJourneys({ from, to, limit = 50 } = {}) {
    const toD = to ? new Date(to) : new Date();
    const fromD = from ? new Date(from) : new Date(toD.getTime() - 30 * DAY_MS);
    const n = Math.min(200, Math.max(1, Number(limit) || 50));
    const { rows } = await q(
      `SELECT COALESCE(visitor_pid, visitor_hash) AS vkey, (visitor_pid IS NOT NULL) AS persistent,
              path, count(*)::int AS views, COALESCE(sum(dwell_ms), 0)::bigint AS dwell_ms,
              COALESCE(max(scroll_pct), 0)::int AS scroll_pct, min(at) AS first_at, max(at) AS last_at,
              count(DISTINCT day)::int AS days
       FROM page_views
       WHERE at >= $1 AND at <= $2 AND NOT bot AND via = 'client' AND COALESCE(visitor_pid, visitor_hash) IS NOT NULL
       GROUP BY vkey, persistent, path`,
      [fromD, toD]
    );
    const byVisitor = new Map();
    for (const r of rows) {
      let v = byVisitor.get(r.vkey);
      if (!v) byVisitor.set(r.vkey, (v = { key: r.vkey.slice(0, 12), persistent: r.persistent, views: 0, dwellMs: 0, days: 0, firstAt: r.first_at, lastAt: r.last_at, topics: [] }));
      v.views += r.views;
      v.dwellMs += Number(r.dwell_ms);
      v.days = Math.max(v.days, r.days);
      if (r.first_at < v.firstAt) v.firstAt = r.first_at;
      if (r.last_at > v.lastAt) v.lastAt = r.last_at;
      v.topics.push({ path: r.path, views: r.views, dwellMs: Number(r.dwell_ms), scrollPct: r.scroll_pct });
    }
    const visitors = [...byVisitor.values()].map((v) => ({ ...v, topics: v.topics.sort((a, b) => b.views - a.views || b.dwellMs - a.dwellMs) }));
    visitors.sort((a, b) => b.views - a.views || b.dwellMs - a.dwellMs);
    return { from: fromD, to: toD, visitors: visitors.slice(0, n) };
  }

  /** Sign-ins, app use and page views past their days go (Postgres keeps them otherwise). */
  async function sweep(now = new Date()) {
    const a = await q(`DELETE FROM login_events WHERE expire_at <= $1`, [now]);
    const b = await q(`DELETE FROM app_usage WHERE expire_at <= $1`, [now]);
    const c = await q(`DELETE FROM page_views WHERE expire_at <= $1`, [now]);
    return { loginEvents: a.rowCount, appUsage: b.rowCount, pageViews: c.rowCount };
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

  return { recordLogin, attachClient, createUsageTracker, sweep, exportUsage, importUsage, recordVisit, recordEngagement, visitStats, visitorJourneys };
}
