// continuum-directory/server/src/admin.js
//
// The admin area's data (Continuum's admins only): users of every kind (with
// their role, last sign-in, last seen, device and apps used), one user's
// sign-ins and app use, roles (each a set of features switched on), the
// default role for new humans, recent sign-ins, and what admins changed.
// Changes clear the access cache, so they apply at once in this API copy and
// within the cache time in the others.

import { badRequest, conflict, notFound } from "./errors.js";
import { APPS, FEATURES, FEATURE_IDS, FEATURE_SET } from "./features.js";
import { ADMIN_ROLE, MEMBER_ROLE, OWNER_EMAILS, roleFeatures } from "./users.js";
import { isId } from "./ids.js";

const PAGE = 50;
const KINDS = ["human", "agent", "app", "org", "department"];

const text = (v, what, max) => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) throw badRequest(`${what} is required.`, "VALIDATION_ERROR", what.toLowerCase());
  if (t.length > max) throw badRequest(`${what} is at most ${max} characters.`, "VALIDATION_ERROR", what.toLowerCase());
  return t;
};
const featureList = (v) => {
  if (!Array.isArray(v)) throw badRequest("features must be a list.", "VALIDATION_ERROR", "features");
  const unknown = v.filter((f) => !FEATURE_IDS.includes(f));
  if (unknown.length) throw badRequest(`Unknown features: ${unknown.join(", ")}.`, "VALIDATION_ERROR", "features");
  return FEATURE_IDS.filter((f) => v.includes(f));
};
const likeOf = (s) => `%${String(s).slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createAdmin({ pool, users, hooks = {} }) {
  const q = (sql, params) => pool.query(sql, params);

  async function roleMap() {
    return new Map((await q(`SELECT * FROM roles`)).rows.map((r) => [r.id, r]));
  }

  /** Per user: each app used (total requests, days, last), most used first. */
  async function appsOf(ids) {
    if (!ids.length) return new Map();
    const { rows } = await q(
      `SELECT user_id, app, sum(count)::int AS count, count(*)::int AS days, max(last_at) AS last_at
       FROM app_usage WHERE user_id = ANY($1) GROUP BY user_id, app ORDER BY count DESC`,
      [ids]
    );
    const out = new Map();
    for (const r of rows) {
      if (!out.has(r.user_id)) out.set(r.user_id, []);
      out.get(r.user_id).push({ app: r.app, count: r.count, days: r.days, lastAt: r.last_at });
    }
    return out;
  }

  /** A user as the list shows them. */
  function userView(u, roles, apps) {
    const roleId = u.role_id ?? MEMBER_ROLE;
    const github = u.github ? { login: u.github.login ?? null, name: u.github.name ?? null, avatarUrl: u.github.avatarUrl ?? null } : null; // not its verified addresses
    return {
      id: u.id,
      kind: u.kind,
      displayName: u.display_name ?? null,
      email: u.email ?? null,
      signsInWith: u.kind !== "human" ? null : github ? "github" : "email",
      github,
      ownerId: u.owner_id ?? null,
      role: u.kind === "human" ? { id: roleId, name: roles.get(roleId)?.name ?? roleId } : null,
      disabled: !!u.disabled,
      owner: !!u.is_owner, // Continuum's owner: always an admin, can't be changed here
      createdAt: u.created_at ?? null,
      lastLoginAt: u.last_login_at ?? null,
      lastLoginMethod: u.last_login_method ?? null,
      lastSeenAt: u.last_seen_at ?? null,
      lastDevice: u.last_device ?? null,
      apps: apps.get(u.id) ?? [],
    };
  }

  // A user with their GitHub details and whether they're the owner
  const SELECT_USER = `
    SELECT u.*, gh.details AS github,
      (gh.user_id IS NOT NULL AND lower(u.email) = ANY($OWNERS) AND COALESCE(gh.details->'verifiedEmails' ? lower(u.email), false)) AS is_owner
    FROM users u
    LEFT JOIN LATERAL (SELECT user_id, details FROM links WHERE user_id = u.id AND system = 'github' LIMIT 1) gh ON true`;
  const withOwners = (sql, n) => sql.replace("$OWNERS", `$${n}`);

  async function getUserRow(id) {
    if (!isId(id)) throw notFound("That user");
    const u = (await q(`${withOwners(SELECT_USER, 2)} WHERE u.id = $1`, [String(id), OWNER_EMAILS])).rows[0];
    if (!u) throw notFound("That user");
    return u;
  }

  return {
    kinds: KINDS,

    /** Every feature, with the app it belongs to (and, for an app's sub-features, the feature that opens it). */
    features: () => FEATURES.map((f) => ({ ...f, appLabel: APPS.find((a) => a.id === f.app)?.label ?? f.app })),

    /**
     * Users, newest first (or by last seen): of one kind (humans unless asked),
     * search by email, name or GitHub name, filter by role, status (active |
     * disabled) and seen in the last N days.
     */
    async listUsers({ kind = "human", search, role, status, seenDays, sort = "created", page = 1 } = {}) {
      const where = [];
      const params = [OWNER_EMAILS];
      const add = (v) => (params.push(v), `$${params.length}`);
      if (kind !== "all") {
        if (!KINDS.includes(kind)) throw badRequest(`kind is one of: all, ${KINDS.join(", ")}.`);
        where.push(`u.kind = ${add(kind)}`);
      }
      if (search) {
        const p = add(likeOf(search));
        where.push(`(u.email ILIKE ${p} OR u.display_name ILIKE ${p} OR gh.details->>'login' ILIKE ${p} OR gh.details->>'name' ILIKE ${p})`);
      }
      if (status === "disabled") where.push(`u.disabled`);
      if (status === "active") where.push(`NOT u.disabled`);
      if (Number(seenDays) > 0) where.push(`u.last_seen_at >= ${add(new Date(Date.now() - Number(seenDays) * 86_400_000))}`);
      // Humans without a role are members
      if (role) where.push(role === MEMBER_ROLE ? `(u.role_id = 'member' OR u.role_id IS NULL)` : `u.role_id = ${add(String(role))}`);
      const p = Math.max(1, Number(page) || 1);
      const order = sort === "seen" ? `u.last_seen_at DESC NULLS LAST, u.id DESC` : `u.created_at DESC, u.id DESC`;
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const base = withOwners(SELECT_USER, 1);
      const [list, total, roles] = await Promise.all([
        q(`${base} ${whereSql} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${(p - 1) * PAGE}`, params),
        q(`SELECT count(*)::int AS n FROM (${base} ${whereSql}) x`, params),
        roleMap(),
      ]);
      const apps = await appsOf(list.rows.map((u) => u.id));
      return { users: list.rows.map((u) => userView(u, roles, apps)), total: total.rows[0].n, page: p, pageSize: PAGE };
    },

    /** One user: everything in the list, plus their sign-ins, mappings and how many projects they have. */
    async getUser(id) {
      const u = await getUserRow(id);
      const [roles, apps, logins, links, projects] = await Promise.all([
        roleMap(),
        appsOf([u.id]),
        q(`SELECT * FROM login_events WHERE user_id = $1 OR (user_id IS NULL AND email = $2) ORDER BY at DESC LIMIT 100`, [u.id, String(u.email ?? "").toLowerCase()]),
        q(`SELECT system, external_id, details FROM links WHERE user_id = $1 ORDER BY system`, [u.id]),
        hooks.countProjects ? hooks.countProjects({ userId: u.id }) : 0,
      ]);
      return {
        ...userView(u, roles, apps),
        projects,
        links: links.rows.map((l) => ({ system: l.system, externalId: l.external_id, details: l.details ?? null })),
        logins: logins.rows.map((l) => ({
          id: String(l.id),
          email: l.email,
          method: l.method,
          ok: l.ok,
          ...(l.reason ? { reason: l.reason } : {}),
          ...(l.signup ? { signup: true } : {}),
          at: l.at,
          ip: l.ip,
          userAgent: l.user_agent,
          browser: l.browser,
          os: l.os,
          device: l.device,
          region: l.region,
          city: l.city,
          network: l.network,
          ...(l.client ? { client: l.client } : {}),
        })),
      };
    },

    /**
     * Changes a user's role or disables them. Nobody disables themself, and
     * the last admin who can sign in stays an admin (nobody could get back
     * in otherwise). Disabling also signs them out everywhere.
     */
    async updateUser(actorId, id, body = {}) {
      const u = await getUserRow(id);
      const set = {};
      if (u.is_owner && ((body.roleId !== undefined && String(body.roleId) !== ADMIN_ROLE) || body.disabled === true)) {
        throw conflict("This is Continuum's owner: always an admin.", "OWNER");
      }
      if (body.roleId !== undefined) {
        if (u.kind !== "human") throw badRequest("Only humans have a Continuum role.");
        if (!(await q(`SELECT 1 FROM roles WHERE id = $1`, [String(body.roleId)])).rowCount) throw badRequest("No such role.");
        set.role_id = String(body.roleId);
      }
      if (body.disabled !== undefined) {
        if (typeof body.disabled !== "boolean") throw badRequest("disabled must be true or false.");
        if (body.disabled && u.id === String(actorId)) throw conflict("You can't disable your own account.", "SELF");
        set.disabled = body.disabled;
      }
      if (!Object.keys(set).length) throw badRequest("Nothing to change (roleId, disabled).");
      const wasAdmin = u.role_id === ADMIN_ROLE && !u.disabled;
      const staysAdmin = (set.role_id ?? u.role_id) === ADMIN_ROLE && !(set.disabled ?? u.disabled);
      if (wasAdmin && !staysAdmin && (await users.countAdmins()) <= 1) {
        throw conflict("This is the last admin: make someone else an admin first.", "LAST_ADMIN");
      }
      const cols = Object.keys(set);
      await q(`UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [u.id, ...cols.map((c) => set[c])]);
      if (set.disabled === true) await users.signOutEverywhere(u.id);
      users.clearAccessCache(u.id);
      return {
        before: { roleId: u.role_id ?? MEMBER_ROLE, disabled: !!u.disabled },
        after: { ...(set.role_id !== undefined ? { roleId: set.role_id } : {}), ...(set.disabled !== undefined ? { disabled: set.disabled } : {}) },
        user: await this.getUser(u.id),
      };
    },

    /** Signs a user out everywhere: Continuum (every device), Continuum Deploy and the Directory. */
    async signOut(id) {
      const u = await getUserRow(id);
      return users.signOutEverywhere(u.id);
    },

    /** Roles, with how many humans have each and its features (admin: all, always). */
    async listRoles() {
      const list = (await q(`SELECT * FROM roles ORDER BY built_in DESC, lower(name)`)).rows;
      const settings = (await q(`SELECT value FROM settings WHERE key = 'access'`)).rows[0]?.value ?? {};
      const counts = new Map((await q(`SELECT COALESCE(role_id, 'member') AS id, count(*)::int AS n FROM users WHERE kind = 'human' GROUP BY 1`)).rows.map((r) => [r.id, r.n]));
      return list.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        features: roleFeatures(r),
        builtIn: !!r.built_in,
        locked: r.id === ADMIN_ROLE, // always everything
        isDefault: (settings.defaultRoleId ?? MEMBER_ROLE) === r.id,
        users: counts.get(r.id) ?? 0,
      }));
    },

    /** A new role: a name, a description and the features switched on. */
    async createRole(body = {}) {
      const name = text(body.name, "Name", 40);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "role";
      let id = slug;
      for (let n = 2; (await q(`SELECT 1 FROM roles WHERE id = $1`, [id])).rowCount; n++) id = `${slug}-${n}`;
      if ((await q(`SELECT 1 FROM roles WHERE lower(name) = lower($1)`, [name])).rowCount) throw conflict("A role with that name exists.", "ROLE_EXISTS", "name");
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 200) : "";
      await q(`INSERT INTO roles (id, name, description, features, feature_set, built_in) VALUES ($1, $2, $3, $4, $5, false)`, [id, name, description, featureList(body.features ?? []), FEATURE_SET]);
      return (await this.listRoles()).find((r) => r.id === id);
    },

    /** Renames a role or switches its features; admin's features can't be switched off. */
    async updateRole(id, body = {}) {
      const r = (await q(`SELECT * FROM roles WHERE id = $1`, [String(id)])).rows[0];
      if (!r) throw notFound("That role");
      const set = {};
      if (body.name !== undefined) {
        if (r.built_in) throw conflict("Built-in roles keep their name.", "BUILT_IN", "name");
        set.name = text(body.name, "Name", 40);
        if ((await q(`SELECT 1 FROM roles WHERE id <> $1 AND lower(name) = lower($2)`, [r.id, set.name])).rowCount) throw conflict("A role with that name exists.", "ROLE_EXISTS", "name");
      }
      if (body.description !== undefined) set.description = String(body.description ?? "").trim().slice(0, 200);
      if (body.features !== undefined) {
        if (r.id === ADMIN_ROLE) throw conflict("Admin always has every feature.", "ADMIN_LOCKED");
        set.features = featureList(body.features);
      }
      if (!Object.keys(set).length) throw badRequest("Nothing to change (name, description, features).");
      const cols = Object.keys(set);
      await q(`UPDATE roles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [r.id, ...cols.map((c) => set[c])]);
      users.clearAccessCache(); // everyone with this role
      return { before: { name: r.name, features: roleFeatures(r) }, role: (await this.listRoles()).find((x) => x.id === r.id) };
    },

    /** Deletes a role; its humans move to another (member unless given), and so does the default. */
    async deleteRole(id, moveTo = MEMBER_ROLE) {
      const r = (await q(`SELECT * FROM roles WHERE id = $1`, [String(id)])).rows[0];
      if (!r) throw notFound("That role");
      if (r.built_in) throw conflict("Built-in roles can't be deleted.", "BUILT_IN");
      const target = String(moveTo);
      if (target === r.id || !(await q(`SELECT 1 FROM roles WHERE id = $1`, [target])).rowCount) throw badRequest("Move its users to another role that exists.");
      const moved = (await q(`UPDATE users SET role_id = $2, updated_at = now() WHERE role_id = $1`, [r.id, target])).rowCount;
      await q(`UPDATE settings SET value = jsonb_set(value, '{defaultRoleId}', to_jsonb($2::text)), updated_at = now() WHERE key = 'access' AND value->>'defaultRoleId' = $1`, [r.id, target]);
      await q(`DELETE FROM roles WHERE id = $1`, [r.id]);
      users.clearAccessCache();
      return { deleted: r.id, movedTo: target, moved };
    },

    async getSettings() {
      const s = (await q(`SELECT value FROM settings WHERE key = 'access'`)).rows[0]?.value ?? {};
      return { defaultRoleId: s.defaultRoleId ?? MEMBER_ROLE };
    },

    /** The role new humans get. */
    async setSettings(body = {}) {
      if (body.defaultRoleId === undefined) throw badRequest("defaultRoleId is required.");
      const id = String(body.defaultRoleId);
      if (!(await q(`SELECT 1 FROM roles WHERE id = $1`, [id])).rowCount) throw badRequest("No such role.");
      await q(
        `INSERT INTO settings (key, value) VALUES ('access', jsonb_build_object('defaultRoleId', $1::text))
         ON CONFLICT (key) DO UPDATE SET value = jsonb_set(settings.value, '{defaultRoleId}', to_jsonb($1::text)), updated_at = now()`,
        [id]
      );
      return this.getSettings();
    },

    /** Recent sign-ins across everyone (failed ones too), newest first. */
    async activity({ limit = 100, failedOnly = false } = {}) {
      const n = Math.min(500, Math.max(1, Number(limit) || 100));
      const { rows } = await q(`SELECT * FROM login_events ${failedOnly ? "WHERE NOT ok" : ""} ORDER BY at DESC LIMIT ${n}`);
      return rows.map((l) => ({
        id: String(l.id),
        userId: l.user_id,
        email: l.email,
        method: l.method,
        ok: l.ok,
        ...(l.reason ? { reason: l.reason } : {}),
        ...(l.signup ? { signup: true } : {}),
        at: l.at,
        ip: l.ip,
        userAgent: l.user_agent,
        browser: l.browser,
        os: l.os,
        device: l.device,
        region: l.region,
        city: l.city,
        network: l.network,
        ...(l.client ? { client: l.client } : {}),
      }));
    },

    /** An admin's change, kept (a failure to record never undoes or blocks it). */
    async recordChange({ type, byId, byEmail, requestId, ip, metadata }) {
      await q(`INSERT INTO admin_audit (type, by_id, by_email, request_id, ip, metadata) VALUES ($1, $2, $3, $4, $5, $6)`, [type, byId ? String(byId) : null, byEmail ?? null, requestId ?? null, ip ?? null, metadata ?? null]);
    },

    /** What admins changed, newest first. */
    async changes({ limit = 100 } = {}) {
      const n = Math.min(500, Math.max(1, Number(limit) || 100));
      const { rows } = await q(`SELECT * FROM admin_audit ORDER BY at DESC LIMIT ${n}`);
      return rows.map((c) => ({ id: String(c.id), type: c.type, by: c.by_id, byEmail: c.by_email, at: c.at, requestId: c.request_id, ip: c.ip, metadata: c.metadata }));
    },
  };
}
