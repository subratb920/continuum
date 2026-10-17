// src/access/access.js
//
// Who may use what. Each user has one role (users.roleId); a role is a set of
// features switched on (roles collection). Built in: admin (everything, always)
// and member (everything but admin). Users from before roles, with no roleId,
// are members. A new user gets the default role (settings "access").
//
// ADMIN_EMAILS (comma-separated) are always admins, whatever their role says:
// the first admin comes from there, and nobody can lock everyone out.
//
// A user's access is cached for a minute per API copy (cleared at once in the
// copy that changes it), so a change applies within a minute everywhere.

import { ObjectId } from "mongodb";
import { FEATURE_IDS } from "./features.js";

export const ADMIN_ROLE = "admin";
export const MEMBER_ROLE = "member";

const BUILT_IN = [
  { _id: ADMIN_ROLE, name: "Admin", description: "Everything, including the admin area.", features: FEATURE_IDS },
  { _id: MEMBER_ROLE, name: "Member", description: "Everything except the admin area.", features: FEATURE_IDS.filter((f) => f !== "admin") },
];

const CACHE_MS = 60_000;
const cache = new Map(); // userId → { at, access }

/** The emails that are always admins (ADMIN_EMAILS), lowercased. */
export function adminEmails(env = process.env) {
  return new Set(
    String(env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

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

/**
 * A user's access now: { userId, email, disabled, role: { id, name }, features, isAdmin },
 * or null when there's no such user.
 */
export async function accessFor(db, userId, { env = process.env, now = Date.now() } = {}) {
  const key = String(userId);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.access;

  const user = await db.collection("users").findOne({ _id: new ObjectId(key) }, { projection: { email: 1, roleId: 1, disabled: 1 } });
  if (!user) return null;
  const email = String(user.email ?? "").toLowerCase();
  const roleId = adminEmails(env).has(email) ? ADMIN_ROLE : user.roleId ?? MEMBER_ROLE;
  const role = (await db.collection("roles").findOne({ _id: roleId })) ?? (await db.collection("roles").findOne({ _id: MEMBER_ROLE })) ?? BUILT_IN[1];
  const features = roleFeatures(role);
  const access = {
    userId: key,
    email: user.email ?? null,
    disabled: !!user.disabled,
    role: { id: role._id, name: role.name },
    features,
    isAdmin: features.includes("admin"),
  };
  cache.set(key, { at: now, access });
  return access;
}

/** Forget cached access (one user, or everyone): after a role or user changes. */
export function clearAccessCache(userId) {
  if (userId === undefined) cache.clear();
  else cache.delete(String(userId));
}
