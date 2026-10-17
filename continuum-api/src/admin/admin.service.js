// src/admin/admin.service.js
//
// The admin area's data: users (with their role, last sign-in, last seen,
// device and apps used), one user's sign-ins and app use, roles (each a set of
// features switched on), the default role for new users, and recent sign-ins.
// Changes clear the access cache, so they apply at once in this API copy and
// within a minute in the others.

import { ObjectId } from "mongodb";
import { AppError } from "../errors/AppError.js";
import { ADMIN_ROLE, MEMBER_ROLE, clearAccessCache, countAdmins, isOwner, roleFeatures, signOutEverywhere } from "../access/access.js";
import { APPS, FEATURES, FEATURE_IDS } from "../access/features.js";

const PAGE = 50;
const oid = (id, what = "user") => {
  if (!ObjectId.isValid(String(id))) throw new AppError(`No such ${what}.`, 404, "NOT_FOUND");
  return new ObjectId(String(id));
};
const text = (v, what, max) => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) throw Object.assign(new AppError(`${what} is required.`, 400, "VALIDATION_ERROR"), { field: what.toLowerCase() });
  if (t.length > max) throw Object.assign(new AppError(`${what} is at most ${max} characters.`, 400, "VALIDATION_ERROR"), { field: what.toLowerCase() });
  return t;
};
const features = (v) => {
  if (!Array.isArray(v)) throw Object.assign(new AppError("features must be a list.", 400, "VALIDATION_ERROR"), { field: "features" });
  const unknown = v.filter((f) => !FEATURE_IDS.includes(f));
  if (unknown.length) throw Object.assign(new AppError(`Unknown features: ${unknown.join(", ")}.`, 400, "VALIDATION_ERROR"), { field: "features" });
  return FEATURE_IDS.filter((f) => v.includes(f));
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A user as the list shows them. */
function userRow(u, roles, apps) {
  const roleId = u.roleId ?? MEMBER_ROLE;
  return {
    id: String(u._id),
    email: u.email ?? null,
    signsInWith: u.githubId ? "github" : "email",
    github: u.github ?? null,
    role: { id: roleId, name: roles.get(roleId)?.name ?? roleId },
    disabled: !!u.disabled,
    owner: isOwner(u), // Continuum's owner: always an admin, can't be changed here
    createdAt: u.createdAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    lastLoginMethod: u.lastLoginMethod ?? null,
    lastSeenAt: u.lastSeenAt ?? null,
    lastDevice: u.lastDevice ?? null,
    apps: apps.get(String(u._id)) ?? [],
  };
}

export function createAdminService(db) {
  const users = db.collection("users");
  const roles = db.collection("roles");

  async function roleMap() {
    return new Map((await roles.find().toArray()).map((r) => [r._id, r]));
  }

  /** Per user: each app used (total requests, days, last), most used first. */
  async function appsOf(userIds) {
    if (!userIds.length) return new Map();
    const rows = await db
      .collection("app_usage")
      .aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: { userId: "$userId", app: "$app" }, count: { $sum: "$count" }, days: { $sum: 1 }, lastAt: { $max: "$lastAt" } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
    const out = new Map();
    for (const r of rows) {
      const k = String(r._id.userId);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({ app: r._id.app, count: r.count, days: r.days, lastAt: r.lastAt });
    }
    return out;
  }

  return {
    /** Every feature, with the app it belongs to (and, for an app's sub-features, the feature that opens it). */
    features: () => FEATURES.map((f) => ({ ...f, appLabel: APPS.find((a) => a.id === f.app)?.label ?? f.app })),

    /**
     * Users, newest first (or by last seen): search by email or GitHub name,
     * filter by role, status (active | disabled) and seen in the last N days.
     */
    async listUsers({ search, role, status, seenDays, sort = "created", page = 1 } = {}) {
      const q = {};
      if (search) {
        const re = new RegExp(escapeRe(String(search).slice(0, 100)), "i");
        q.$or = [{ email: re }, { "github.login": re }, { "github.name": re }];
      }
      if (status === "disabled") q.disabled = true;
      if (status === "active") q.disabled = { $ne: true };
      if (Number(seenDays) > 0) q.lastSeenAt = { $gte: new Date(Date.now() - Number(seenDays) * 86_400_000) };
      // Users without a role (from before roles) are members
      if (role) q.$and = [role === MEMBER_ROLE ? { $or: [{ roleId: MEMBER_ROLE }, { roleId: { $exists: false } }] } : { roleId: String(role) }];
      const p = Math.max(1, Number(page) || 1);
      const order = sort === "seen" ? { lastSeenAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };
      const projection = { passwordHash: 0, githubAccessToken: 0 };
      const [list, total, rmap] = await Promise.all([
        users.find(q, { projection }).sort(order).skip((p - 1) * PAGE).limit(PAGE).toArray(),
        users.countDocuments(q),
        roleMap(),
      ]);
      const apps = await appsOf(list.map((u) => u._id));
      return { users: list.map((u) => userRow(u, rmap, apps)), total, page: p, pageSize: PAGE };
    },

    /** One user: everything in the list, plus their sign-ins and how much they have. */
    async getUser(id) {
      const _id = oid(id);
      const u = await users.findOne({ _id }, { projection: { passwordHash: 0, githubAccessToken: 0 } });
      if (!u) throw new AppError("No such user.", 404, "NOT_FOUND");
      const [rmap, apps, logins, projects] = await Promise.all([
        roleMap(),
        appsOf([_id]),
        db.collection("login_events").find({ $or: [{ userId: _id }, { userId: null, email: String(u.email ?? "").toLowerCase() }] }).sort({ at: -1 }).limit(100).toArray(),
        db.collection("projects").countDocuments({ userId: _id }),
      ]);
      return {
        ...userRow(u, rmap, apps),
        projects,
        logins: logins.map(({ _id: lid, userId, expireAt, ...l }) => ({ id: String(lid), ...l })),
      };
    },

    /**
     * Changes a user's role or disables them. Nobody disables themself, and
     * the last admin who can sign in stays an admin (nobody could get back
     * in otherwise). Disabling also signs them out everywhere.
     */
    async updateUser(actorId, id, body = {}) {
      const _id = oid(id);
      const u = await users.findOne({ _id }, { projection: { email: 1, roleId: 1, disabled: 1, githubId: 1 } });
      if (!u) throw new AppError("No such user.", 404, "NOT_FOUND");
      const set = {};
      if (isOwner(u) && ((body.roleId !== undefined && String(body.roleId) !== ADMIN_ROLE) || body.disabled === true)) {
        throw new AppError("This is Continuum's owner: always an admin.", 409, "OWNER");
      }
      if (body.roleId !== undefined) {
        if (!(await roles.findOne({ _id: String(body.roleId) }, { projection: { _id: 1 } }))) throw new AppError("No such role.", 400, "VALIDATION_ERROR");
        set.roleId = String(body.roleId);
      }
      if (body.disabled !== undefined) {
        if (typeof body.disabled !== "boolean") throw new AppError("disabled must be true or false.", 400, "VALIDATION_ERROR");
        if (body.disabled && String(_id) === String(actorId)) throw new AppError("You can't disable your own account.", 409, "SELF");
        set.disabled = body.disabled;
      }
      if (!Object.keys(set).length) throw new AppError("Nothing to change (roleId, disabled).", 400, "VALIDATION_ERROR");
      const wasAdmin = u.roleId === ADMIN_ROLE && !u.disabled;
      const staysAdmin = (set.roleId ?? u.roleId) === ADMIN_ROLE && !(set.disabled ?? u.disabled);
      if (wasAdmin && !staysAdmin && (await countAdmins(db)) <= 1) {
        throw new AppError("This is the last admin: make someone else an admin first.", 409, "LAST_ADMIN");
      }
      await users.updateOne({ _id }, { $set: { ...set, updatedAt: new Date() } });
      if (set.disabled === true) await signOutEverywhere(db, _id);
      clearAccessCache(_id);
      return { before: { roleId: u.roleId ?? MEMBER_ROLE, disabled: !!u.disabled }, after: set, user: await this.getUser(id) };
    },

    /** Signs a user out everywhere: Continuum (every device) and Continuum Deploy. */
    async signOut(id) {
      const _id = oid(id);
      if (!(await users.findOne({ _id }, { projection: { _id: 1 } }))) throw new AppError("No such user.", 404, "NOT_FOUND");
      return signOutEverywhere(db, _id);
    },

    /** Roles, with how many users have each and its features (admin: all, always). */
    async listRoles() {
      const list = await roles.find().sort({ builtIn: -1, name: 1 }).toArray();
      const settings = await db.collection("settings").findOne({ _id: "access" });
      const counts = new Map((await users.aggregate([{ $group: { _id: { $ifNull: ["$roleId", MEMBER_ROLE] }, n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n]));
      return list.map((r) => ({
        id: r._id,
        name: r.name,
        description: r.description ?? "",
        features: roleFeatures(r),
        builtIn: !!r.builtIn,
        locked: r._id === ADMIN_ROLE, // always everything
        isDefault: (settings?.defaultRoleId ?? MEMBER_ROLE) === r._id,
        users: counts.get(r._id) ?? 0,
      }));
    },

    /** A new role: a name, a description and the features switched on. */
    async createRole(body = {}) {
      const name = text(body.name, "Name", 40);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "role";
      let id = slug;
      for (let n = 2; await roles.findOne({ _id: id }, { projection: { _id: 1 } }); n++) id = `${slug}-${n}`;
      if (await roles.findOne({ name: new RegExp(`^${escapeRe(name)}$`, "i") }, { projection: { _id: 1 } })) throw Object.assign(new AppError("A role with that name exists.", 409, "ROLE_EXISTS"), { field: "name" });
      const now = new Date();
      const doc = { _id: id, name, description: typeof body.description === "string" ? body.description.trim().slice(0, 200) : "", features: features(body.features ?? []), builtIn: false, createdAt: now, updatedAt: now };
      await roles.insertOne(doc);
      return (await this.listRoles()).find((r) => r.id === id);
    },

    /** Renames a role or switches its features; admin's features can't be switched off. */
    async updateRole(id, body = {}) {
      const r = await roles.findOne({ _id: String(id) });
      if (!r) throw new AppError("No such role.", 404, "NOT_FOUND");
      const set = {};
      if (body.name !== undefined) {
        if (r.builtIn) throw Object.assign(new AppError("Built-in roles keep their name.", 409, "BUILT_IN"), { field: "name" });
        set.name = text(body.name, "Name", 40);
        if (await roles.findOne({ _id: { $ne: r._id }, name: new RegExp(`^${escapeRe(set.name)}$`, "i") }, { projection: { _id: 1 } })) throw Object.assign(new AppError("A role with that name exists.", 409, "ROLE_EXISTS"), { field: "name" });
      }
      if (body.description !== undefined) set.description = String(body.description ?? "").trim().slice(0, 200);
      if (body.features !== undefined) {
        if (r._id === ADMIN_ROLE) throw new AppError("Admin always has every feature.", 409, "ADMIN_LOCKED");
        set.features = features(body.features);
      }
      if (!Object.keys(set).length) throw new AppError("Nothing to change (name, description, features).", 400, "VALIDATION_ERROR");
      await roles.updateOne({ _id: r._id }, { $set: { ...set, updatedAt: new Date() } });
      clearAccessCache(); // everyone with this role
      return { before: { name: r.name, features: roleFeatures(r) }, role: (await this.listRoles()).find((x) => x.id === r._id) };
    },

    /** Deletes a role; its users move to another (member unless given), and so does the default. */
    async deleteRole(id, moveTo = MEMBER_ROLE) {
      const r = await roles.findOne({ _id: String(id) });
      if (!r) throw new AppError("No such role.", 404, "NOT_FOUND");
      if (r.builtIn) throw new AppError("Built-in roles can't be deleted.", 409, "BUILT_IN");
      const target = String(moveTo);
      if (target === r._id || !(await roles.findOne({ _id: target }, { projection: { _id: 1 } }))) throw new AppError("Move its users to another role that exists.", 400, "VALIDATION_ERROR");
      const moved = (await users.updateMany({ roleId: r._id }, { $set: { roleId: target, updatedAt: new Date() } })).modifiedCount;
      await db.collection("settings").updateOne({ _id: "access", defaultRoleId: r._id }, { $set: { defaultRoleId: target, updatedAt: new Date() } });
      await roles.deleteOne({ _id: r._id });
      clearAccessCache();
      return { deleted: r._id, movedTo: target, moved };
    },

    async getSettings() {
      const s = await db.collection("settings").findOne({ _id: "access" });
      return { defaultRoleId: s?.defaultRoleId ?? MEMBER_ROLE };
    },

    /** The role new users get. */
    async setSettings(body = {}) {
      if (body.defaultRoleId === undefined) throw new AppError("defaultRoleId is required.", 400, "VALIDATION_ERROR");
      const id = String(body.defaultRoleId);
      if (!(await roles.findOne({ _id: id }, { projection: { _id: 1 } }))) throw new AppError("No such role.", 400, "VALIDATION_ERROR");
      await db.collection("settings").updateOne({ _id: "access" }, { $set: { defaultRoleId: id, updatedAt: new Date() } }, { upsert: true });
      return this.getSettings();
    },

    /** Recent sign-ins across everyone (failed ones too), newest first. */
    async activity({ limit = 100, failedOnly = false } = {}) {
      const n = Math.min(500, Math.max(1, Number(limit) || 100));
      const list = await db.collection("login_events").find(failedOnly ? { ok: false } : {}).sort({ at: -1 }).limit(n).toArray();
      return list.map(({ _id, expireAt, ...l }) => ({ id: String(_id), ...l, userId: l.userId ? String(l.userId) : null }));
    },
  };
}
