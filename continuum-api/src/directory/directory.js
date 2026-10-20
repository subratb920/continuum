// src/directory/directory.js
//
// continuum-directory (Continuum's directory: users of every kind, roles and
// features, organizations and departments, sign-ins and app use) runs inside
// this API on its own Postgres (DIRECTORY_DATABASE_URL), mounted at
// /directory. It lives in ../continuum-directory/server and imports nothing
// from here; what it needs from Continuum it asks through these hooks.
// DIRECTORY_MODULE points elsewhere when the folder is mounted at another path
// (Docker Compose). It's required: who may use what comes from it.

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { logger } from "../logging/logger.js";
import { createOAuthStore } from "../oauth/oauth.store.js";

const modulePath = process.env.DIRECTORY_MODULE || new URL("../../../continuum-directory/server/src/index.js", import.meta.url).href;
const mod = await import(modulePath);

const oid = (id) => new ObjectId(String(id));

/** What the directory asks of Continuum. */
const hooks = {
  // A Continuum account the directory doesn't know yet (it's added as a human)
  async continuumUser(id) {
    if (!ObjectId.isValid(String(id))) return null;
    const u = await getDB().collection("users").findOne({ _id: oid(id) }, { projection: { email: 1, createdAt: 1, githubId: 1, github: 1 } });
    if (!u) return null;
    return { email: u.email ?? null, createdAt: u.createdAt ?? null, github: u.githubId ? { id: u.githubId, ...(u.github ?? {}) } : null };
  },
  // Signing out everywhere: Continuum's kept sessions (GitHub sign-in) and every Continuum Deploy and Directory sign-in
  async endSessions(userId) {
    const _id = oid(userId);
    await getDB().collection("sessions").deleteMany({ userId: _id });
    const deploySessions = await createOAuthStore(getDB()).revokeAllForUser(_id);
    return { deploySessions };
  },
  // Projects (they stay in Continuum's MongoDB): someone's, a space's, a department's
  async countProjects({ userId, spaceId, departmentId } = {}) {
    const q = {};
    if (userId) q.userId = oid(userId);
    if (spaceId) q.spaceId = spaceId;
    if (departmentId) q.departmentIds = String(departmentId);
    return getDB().collection("projects").countDocuments(q);
  },
  // Read once, to fill an empty directory with what Continuum kept before it existed (nothing there changes)
  legacyMongo: () => getDB(),
};

export const directory = mod.createDirectory(mod.directoryConfigFromEnv(process.env), { log: logger.child({ part: "directory" }), hooks });
export const { features, ORG_ROLES, parseSpace, personalSpaceId, orgSpaceId, DirectoryError } = mod;
/** What the rest of the API asks the directory. */
export const dir = directory.api;
