// src/access/access.js
//
// Who may use what. Each user has one role (users.roleId); a role is a set of
// features switched on (roles collection). Built in: admin (everything, always)
// and member (everything but admin). Users from before roles, with no roleId,
// are members. A new user gets the default role (settings "access").
//
// Admins are only ever users whose role is admin, in this database: nothing
// outside it (no setting, no cloud) says who they are. The owner (OWNER_EMAILS,
// here in the code) is always one: their account signed in with GitHub, which
// has verified the address (an email sign-up isn't verified, so it never
// makes an owner). Without any admin, the first one claims it with a one-time
// setup code that this API writes to its own log (claimAdmin); after that,
// admins make admins. The owner and the last admin can't be removed
// (admin.service.js).
//
// Sessions: each user has a session version (users.tokenVersion); every
// sign-in token carries it (tv). Signing someone out everywhere raises it,
// so every token made before stops working at once.
//
// A user's access is cached for a minute per API copy (cleared at once in the
// copy that changes it), so a change applies within a minute everywhere.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { FEATURE_IDS } from "./features.js";
import { createOAuthStore } from "../oauth/oauth.store.js";

export const ADMIN_ROLE = "admin";
export const MEMBER_ROLE = "member";

const BUILT_IN = [
  { _id: ADMIN_ROLE, name: "Admin", description: "Everything, including the admin area.", features: FEATURE_IDS },
  { _id: MEMBER_ROLE, name: "Member", description: "Everything except the admin area.", features: FEATURE_IDS.filter((f) => f !== "admin") },
];

/** Continuum's owner: always an admin, through GitHub sign-in (a verified address) only. */
export const OWNER_EMAILS = ["subratb920@gmail.com"];
export const isOwnerEmail = (email) => OWNER_EMAILS.includes(String(email ?? "").trim().toLowerCase());
/** Is this account the owner (signed in with GitHub, with the owner's address)? */
export const isOwner = (user) => !!user?.githubId && isOwnerEmail(user.email);

const CACHE_MS = 60_000;
const SETUP_HOURS = 24;
const cache = new Map(); // userId → { at, access }

/** The built-in roles and the access settings, created once (safe on every start). */
export async function ensureAccess(db) {
  const roles = db.collection("roles");
  const now = new Date();
  for (const r of BUILT_IN) {
    await roles.updateOne({ _id: r._id }, { $setOnInsert: { ...r, builtIn: true, createdAt: now, updatedAt: now } }, { upsert: true });
  }
  await db.collection("settings").updateOne({ _id: "access" }, { $setOnInsert: { defaultRoleId: MEMBER_ROLE, updatedAt: now } }, { upsert: true });
  await db.collection("users").createIndex({ roleId: 1 }, { name: "roleId" });
  await db.collection("admin_audit").createIndex({ at: -1 }, { name: "at" }); // what admins changed
}

/**
 * The owner's account (signed in with GitHub) is an admin, enabled: on every
 * start, and at each GitHub sign-in (auth.routes.js). Returns how many changed.
 */
export async function ensureOwners(db) {
  const res = await db.collection("users").updateMany(
    { email: { $in: OWNER_EMAILS }, githubId: { $exists: true }, $or: [{ roleId: { $ne: ADMIN_ROLE } }, { disabled: true }] },
    { $set: { roleId: ADMIN_ROLE, disabled: false, updatedAt: new Date() } }
  );
  if (res.modifiedCount) clearAccessCache();
  return res.modifiedCount;
}

/** Admins who can sign in (admin role, not disabled). */
export function countAdmins(db) {
  return db.collection("users").countDocuments({ roleId: ADMIN_ROLE, disabled: { $ne: true } });
}

const hashCode = (code) => createHash("sha256").update(String(code).replace(/[^A-Z0-9]/gi, "").toUpperCase()).digest();

/**
 * While there's no admin: a one-time setup code (24 hours), returned for the
 * API's own log only (never sent to a page). A code still valid is kept (only
 * its hash is stored, so another copy of the API starting doesn't replace the
 * one already in a log): { existing: true }. With an admin: none, and any old
 * code is gone. Run on every start.
 */
export async function prepareAdminSetup(db, { now = new Date() } = {}) {
  const settings = db.collection("settings");
  if ((await countAdmins(db)) > 0) {
    await settings.updateOne({ _id: "access" }, { $unset: { adminSetup: "" } });
    return null;
  }
  const current = (await settings.findOne({ _id: "access" }, { projection: { adminSetup: 1 } }))?.adminSetup;
  if (current?.expiresAt > now) return { existing: true, expiresAt: current.expiresAt };
  const raw = randomBytes(10).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(12, "X").slice(0, 12);
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const expiresAt = new Date(now.getTime() + SETUP_HOURS * 3_600_000);
  await settings.updateOne({ _id: "access" }, { $set: { adminSetup: { codeHash: hashCode(code).toString("hex"), expiresAt } } }, { upsert: true });
  return { code, expiresAt };
}

/** Is there no admin yet, with a setup code waiting (the Admin page then offers to claim it)? */
export async function adminSetupOpen(db, { now = new Date() } = {}) {
  const s = await db.collection("settings").findOne({ _id: "access" }, { projection: { adminSetup: 1 } });
  if (!s?.adminSetup || s.adminSetup.expiresAt <= now) return false;
  return (await countAdmins(db)) === 0;
}

/**
 * The first admin: a signed-in user with the setup code becomes admin, once,
 * only while there's no admin. False for a wrong or expired code.
 */
export async function claimAdmin(db, userId, code, { now = new Date() } = {}) {
  const settings = db.collection("settings");
  const s = await settings.findOne({ _id: "access" }, { projection: { adminSetup: 1 } });
  if (!s?.adminSetup || s.adminSetup.expiresAt <= now || (await countAdmins(db)) > 0) return false;
  const want = Buffer.from(s.adminSetup.codeHash, "hex");
  const got = hashCode(code ?? "");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  // Used once: the code goes before the role is given (two claims at once: one wins)
  const taken = await settings.updateOne({ _id: "access", "adminSetup.codeHash": s.adminSetup.codeHash }, { $unset: { adminSetup: "" } });
  if (taken.modifiedCount !== 1) return false;
  await db.collection("users").updateOne({ _id: new ObjectId(String(userId)) }, { $set: { roleId: ADMIN_ROLE, updatedAt: now } });
  clearAccessCache(userId);
  return true;
}

/** The role a new user gets (the default role, if it still exists). */
export async function roleForNewUser(db) {
  const s = await db.collection("settings").findOne({ _id: "access" });
  const id = s?.defaultRoleId ?? MEMBER_ROLE;
  return (await db.collection("roles").findOne({ _id: id }, { projection: { _id: 1 } })) ? id : MEMBER_ROLE;
}

/** A role's features: only known ones; admin always has them all. */
export function roleFeatures(role) {
  if (role?._id === ADMIN_ROLE) return [...FEATURE_IDS];
  return FEATURE_IDS.filter((f) => role?.features?.includes(f));
}

/** A user's session version: what their sign-in tokens must carry (tv). */
export const sessionVersion = (user) => user?.tokenVersion ?? 0;

/**
 * A user's access now: { userId, email, disabled, role: { id, name }, features,
 * isAdmin, tokenVersion }, or null when there's no such user.
 */
export async function accessFor(db, userId, { now = Date.now() } = {}) {
  const key = String(userId);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.access;

  const user = await db.collection("users").findOne({ _id: new ObjectId(key) }, { projection: { email: 1, roleId: 1, disabled: 1, tokenVersion: 1 } });
  if (!user) return null;
  const role = (await db.collection("roles").findOne({ _id: user.roleId ?? MEMBER_ROLE })) ?? (await db.collection("roles").findOne({ _id: MEMBER_ROLE })) ?? BUILT_IN[1];
  const features = roleFeatures(role);
  const access = {
    userId: key,
    email: user.email ?? null,
    disabled: !!user.disabled,
    role: { id: role._id, name: role.name },
    features,
    isAdmin: features.includes("admin"),
    tokenVersion: sessionVersion(user),
  };
  cache.set(key, { at: now, access });
  return access;
}

/** Forget cached access (one user, or everyone): after a role or user changes. */
export function clearAccessCache(userId) {
  if (userId === undefined) cache.clear();
  else cache.delete(String(userId));
}

/**
 * Signs a user out everywhere: every Continuum sign-in token made before stops
 * working (session version up), GitHub sign-in's kept session goes, and so do
 * their Continuum Deploy sessions.
 */
export async function signOutEverywhere(db, userId, { now = new Date() } = {}) {
  const _id = new ObjectId(String(userId));
  await db.collection("users").updateOne({ _id }, { $inc: { tokenVersion: 1 }, $set: { updatedAt: now } });
  await db.collection("sessions").deleteMany({ userId: _id });
  const deploySessions = await createOAuthStore(db).revokeAllForUser(_id);
  clearAccessCache(_id);
  return { deploySessions };
}
