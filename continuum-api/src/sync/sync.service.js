// src/sync/sync.service.js
//
// Production sync: copies your account's records from this Continuum (with its
// brain and Continuum Deploy) into another one (production), add only.
//   On production: a one-time sync code for the account you're signed in to
//   there (10 minutes, usable once).
//   Here: Preview (what would be sent) and Merge (sent with that code).
//   On production: every record is moved onto that account, then added where
//   it's missing; anything already there is kept as it is (same id, or the
//   same value in a unique index); nothing is changed or deleted.
// The brain's part goes to its brain-api (X-Brain-Token), Continuum Deploy's to
// its API with a short-lived token signed like Deploy's sign-in tokens
// (sync: "export" | "import"), so no new shared secret is needed.

import { BSON, ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { getOAuthConfig } from "../oauth/oauth.config.js";
import { randomToken, sha256, signJwt } from "../oauth/oauth.crypto.js";
import { addOnly, countsOf, pickProjects, remap } from "./merge.js";
import { personalProjectFilter } from "../spaces/projectAccess.js";
import { dir } from "../directory/directory.js";

const { EJSON } = BSON;
export const SYNC_CODES = "sync_codes";
const CODE_MINUTES = 10;
/** Most records of one kind in one sync (more is refused, not cut silently: see importWithCode). */
const MAX_PER_COLLECTION = 20_000;
/** Projects and what hangs off them (by project), and your own records (by userId). */
const MINE = ["project_creations", "app_usage"];

/** A one-time code for the signed-in account (shown once; only its hash is kept). */
export async function createSyncCode(userId) {
  const code = randomToken(18);
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
  await getDB().collection(SYNC_CODES).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  await getDB().collection(SYNC_CODES).insertOne({ codeHash: sha256(code), userId: new ObjectId(String(userId)), expiresAt, usedAt: null, createdAt: new Date() });
  return { code, expiresAt };
}

/** The account a code is for (it's used up now), or an error. */
async function takeCode(code) {
  if (typeof code !== "string" || code.length < 16) throw new AppError("Give the sync code from production.", 401, "SYNC_CODE_INVALID");
  const r = await getDB().collection(SYNC_CODES).findOneAndUpdate({ codeHash: sha256(code), usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } });
  if (!r) throw new AppError("That sync code isn't valid any more (used, or older than 10 minutes). Create a new one on production.", 401, "SYNC_CODE_INVALID");
  const user = await getDB().collection("users").findOne({ _id: r.userId }, { projection: { email: 1 } });
  if (!user) throw new AppError("The account of that sync code is gone.", 404, "NOT_FOUND");
  return user;
}

/** A short-lived token Continuum Deploy accepts for a sync of this account's data. */
function deployToken(user, mode) {
  const cfg = getOAuthConfig();
  if (!cfg) return null;
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iss: cfg.issuer, aud: cfg.audience, sub: String(user._id), email: user.email, tenant: `u:${user._id}`, sync: mode, iat: now, exp: now + 120, jti: randomToken(16) }, cfg.privateKey, cfg.keyId);
}

async function call(url, init, what) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new AppError(`${what} isn't reachable (${new URL(url).host}).`, 503, "SYNC_UNREACHABLE");
  }
  const text = await res.text();
  let data = null;
  try {
    data = EJSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) throw new AppError(`${what} refused: ${data?.error?.message ?? data?.error ?? `HTTP ${res.status}`}`, res.status >= 500 ? 502 : res.status, data?.code ?? data?.error?.code ?? "SYNC_REFUSED");
  return data;
}

/** Everything of this account here: Continuum's records, its brain's and its Deploy's (each part says if it couldn't be read). */
export async function exportAccount(userId) {
  const db = getDB();
  const uid = new ObjectId(String(userId));
  const mine = { $or: [{ userId: uid }, { userId: String(uid) }] };
  // Your personal projects (an organization's projects are the organization's, not this account's)
  const projects = await db.collection("projects").find({ $and: [mine, { $or: personalProjectFilter(uid).$or }] }).toArray();
  const pids = projects.flatMap((p) => [p._id, String(p._id)]);
  const continuum = {
    projects,
    bridges: await db.collection("bridges").find({ projectId: { $in: pids } }).toArray(),
    bridge_counters: await db.collection("bridge_counters").find({ projectId: { $in: pids } }).toArray(),
  };
  for (const c of MINE) if (c !== "app_usage") continuum[c] = await db.collection(c).find(mine).toArray();
  // App use is the directory's (sent in the same shape as before, so an older Continuum reads it too)
  continuum.app_usage = (await dir.exportUsage(String(uid))).map((a) => ({ _id: `${uid}:${a.app}:${a.day}`, userId: uid, app: a.app, day: a.day, count: a.count, firstAt: a.firstAt, lastAt: a.lastAt }));

  const out = { fromUserId: String(uid), continuum, brain: null, deploy: null, notes: [] };
  if (process.env.BRAIN_URL && process.env.BRAIN_INTERNAL_TOKEN) {
    try {
      out.brain = await call(`${process.env.BRAIN_URL.replace(/\/+$/, "")}/sync/export`, { method: "POST", headers: { "X-Brain-Token": process.env.BRAIN_INTERNAL_TOKEN, "X-Continuum-User": String(uid) } }, "The brain");
    } catch (err) {
      out.notes.push(`Brain: ${err.message}`);
    }
  } else out.notes.push("Brain: not connected here.");
  const token = process.env.DEPLOY_API_URL ? deployToken({ _id: uid, email: (await db.collection("users").findOne({ _id: uid }, { projection: { email: 1 } }))?.email ?? "" }, "export") : null;
  if (token) {
    try {
      out.deploy = await call(`${process.env.DEPLOY_API_URL.replace(/\/+$/, "")}/internal/sync/export`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }, "Continuum Deploy");
    } catch (err) {
      out.notes.push(`Deploy: ${err.message}`);
    }
  } else out.notes.push("Deploy: not connected here (DEPLOY_API_URL, or sign-in signing keys, not set).");
  return out;
}

/** Sends this account's records to production with its sync code; answers production's report. */
export async function pushToProduction(userId, target, code) {
  let base;
  try {
    base = new URL(String(target));
  } catch {
    throw Object.assign(new AppError("Give production's API address, e.g. https://api.continuum-console.one.", 400, "VALIDATION_ERROR"), { field: "target" });
  }
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw Object.assign(new AppError("Production's address must be https.", 400, "VALIDATION_ERROR"), { field: "target" });
  const payload = await exportAccount(userId);
  const report = await call(`${base.origin}/sync/import`, { method: "POST", headers: { "Content-Type": "application/json", "X-Sync-Code": String(code ?? "") }, body: EJSON.stringify(payload, { relaxed: false }) }, "Production");
  return { sent: countsOf(payload), report };
}

/** Production: receives an account's records with a sync code, moves them onto that account, adds what's missing. */
export async function importWithCode(code, payload) {
  const user = await takeCode(code);
  const from = String(payload?.fromUserId ?? "");
  if (!/^[a-f0-9]{24}$/.test(from)) throw new AppError("The sync is missing where it came from.", 400, "VALIDATION_ERROR");
  const to = String(user._id);
  const db = getDB();
  const report = { account: user.email, continuum: {}, brain: null, deploy: null, notes: [] };

  // Continuum: only these collections, every record moved onto the account
  const allowed = ["projects", "bridges", "bridge_counters", ...MINE];
  // A project this account already has here under the same name keeps its own (pickProjects)
  const here = await db.collection("projects").find(personalProjectFilter(user._id), { projection: { name: 1 } }).toArray();
  const projects = new Set();
  for (const name of allowed) {
    const given = Array.isArray(payload.continuum?.[name]) ? payload.continuum[name] : [];
    if (given.length > MAX_PER_COLLECTION) throw new AppError(`Too many ${name} in one sync (over ${MAX_PER_COLLECTION}).`, 413, "SYNC_TOO_BIG");
    const docs = given.map((d) => remap(d, from, to));
    // Records of this account only: projects (and by-user records) must name it; bridges must belong to one of its projects
    const own = name === "projects" || MINE.includes(name) ? docs.filter((d) => String(d.userId) === to) : docs.filter((d) => projects.has(String(d.projectId)));
    if (name === "app_usage") {
      // Into the directory (a day already counted here keeps its own)
      report.continuum.app_usage = { ...(await dir.importUsage(to, own)), refused: docs.length - own.length };
      continue;
    }
    if (name === "projects") {
      // Into this account's personal space (never an organization)
      for (const p of own) {
        p.spaceId = `u:${to}`;
        delete p.departmentIds;
      }
      const pick = pickProjects(own, here);
      pick.ids.forEach((id) => projects.add(id));
      const r = await addOnly(db.collection(name), pick.add);
      report.continuum.projects = { added: r.added, kept: r.kept + (own.length - pick.add.length - pick.sameName), sameName: pick.sameName, refused: docs.length - own.length };
      continue;
    }
    report.continuum[name] = { ...(await addOnly(db.collection(name), own)), refused: docs.length - own.length };
  }

  if (payload.brain) {
    if (process.env.BRAIN_URL && process.env.BRAIN_INTERNAL_TOKEN) {
      try {
        report.brain = await call(`${process.env.BRAIN_URL.replace(/\/+$/, "")}/sync/import`, { method: "POST", headers: { "Content-Type": "application/json", "X-Brain-Token": process.env.BRAIN_INTERNAL_TOKEN, "X-Continuum-User": to }, body: EJSON.stringify(remap(payload.brain, from, to), { relaxed: false }) }, "The brain");
      } catch (err) {
        report.notes.push(`Brain: ${err.message}`);
      }
    } else report.notes.push("Brain: not connected on production.");
  }
  if (payload.deploy) {
    const token = process.env.DEPLOY_API_URL ? deployToken(user, "import") : null;
    if (token) {
      try {
        report.deploy = await call(`${process.env.DEPLOY_API_URL.replace(/\/+$/, "")}/internal/sync/import`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: EJSON.stringify(remap(payload.deploy, from, to), { relaxed: false }) }, "Continuum Deploy");
      } catch (err) {
        report.notes.push(`Deploy: ${err.message}`);
      }
    } else report.notes.push("Deploy: not connected on production (DEPLOY_API_URL not set).");
  }
  return report;
}

export { EJSON, countsOf };
