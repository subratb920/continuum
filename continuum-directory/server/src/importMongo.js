// continuum-directory/server/src/importMongo.js
//
// Once, into an empty directory: what Continuum kept in its own MongoDB about
// users and access before the directory existed — roles, the default role,
// each account's role, status and last sign-in (as a human), GitHub links,
// sign-ins, app use, admin changes and organizations. Add-only: rows already
// here are kept, and nothing in MongoDB is changed or deleted. All or nothing
// (one transaction); the counts are kept in settings ("mongo_import").

import { tx } from "./db/pool.js";

const hex = (v) => (v == null ? null : String(v));
const HEX24 = /^[a-f0-9]{24}$/;
const ROLES = ["owner", "admin", "member", "viewer"];

export async function importFromMongo({ pool, mongo, log }) {
  const done = (await pool.query(`SELECT value FROM settings WHERE key = 'mongo_import'`)).rows[0];
  if (done) return { skipped: true, ...done.value };
  const counts = {};
  const add = (k, n) => (counts[k] = (counts[k] ?? 0) + n);

  await tx(pool, async (c) => {
    const ins = async (k, sql, params) => add(k, (await c.query(sql, params)).rowCount);

    for (const r of await mongo.collection("roles").find().toArray()) {
      await ins(
        "roles",
        `INSERT INTO roles (id, name, description, features, feature_set, built_in, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), COALESCE($8, now())) ON CONFLICT DO NOTHING`,
        [String(r._id), r.name ?? String(r._id), r.description ?? "", r.features ?? [], r.featureSet ?? 1, !!r.builtIn, r.createdAt ?? null, r.updatedAt ?? null]
      );
    }
    const access = await mongo.collection("settings").findOne({ _id: "access" });
    if (access?.defaultRoleId) await ins("settings", `INSERT INTO settings (key, value) VALUES ('access', $1) ON CONFLICT DO NOTHING`, [{ defaultRoleId: access.defaultRoleId }]);

    const accounts = await mongo.collection("users").find({}, { projection: { passwordHash: 0, githubAccessToken: 0 } }).toArray();
    for (const u of accounts) {
      const id = hex(u._id);
      if (!HEX24.test(id)) continue;
      await ins(
        "users",
        `INSERT INTO users (id, kind, email, display_name, role_id, disabled, token_version, last_login_at, last_login_method, last_seen_at, last_device, last_space_id, created_at, updated_at)
         VALUES ($1, 'human', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()), COALESCE($13, now())) ON CONFLICT DO NOTHING`,
        [
          id,
          u.email ? String(u.email).toLowerCase() : null,
          u.github?.name ?? u.github?.login ?? u.name ?? null,
          u.roleId ?? null,
          !!u.disabled,
          u.tokenVersion ?? 0,
          u.lastLoginAt ?? null,
          u.lastLoginMethod ?? null,
          u.lastSeenAt ?? null,
          u.lastDevice ?? null,
          typeof u.lastSpaceId === "string" ? u.lastSpaceId : null,
          u.createdAt ?? null,
          u.updatedAt ?? null,
        ]
      );
      await ins("links", `INSERT INTO links (user_id, system, external_id) VALUES ($1, 'continuum', $1) ON CONFLICT DO NOTHING`, [id]);
      if (u.githubId) {
        await ins("links", `INSERT INTO links (user_id, system, external_id, details) VALUES ($1, 'github', $2, $3) ON CONFLICT DO NOTHING`, [
          id,
          String(u.githubId),
          { login: u.github?.login ?? null, name: u.github?.name ?? null, avatarUrl: u.github?.avatarUrl ?? null },
        ]);
      }
    }

    for await (const l of mongo.collection("login_events").find()) {
      await ins(
        "loginEvents",
        `INSERT INTO login_events (user_id, email, method, ok, reason, signup, at, ip, user_agent, browser, os, device, region, city, network, client, expire_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [hex(l.userId), l.email ?? null, l.method ?? "email", l.ok !== false, l.reason ?? null, !!l.signup, l.at ?? new Date(), l.ip ?? null, l.userAgent ?? null, l.browser ?? null, l.os ?? null, l.device ?? null, l.region ?? null, l.city ?? null, l.network ?? null, l.client ?? null, l.expireAt ?? new Date(Date.now() + 180 * 86_400_000)]
      );
    }

    for await (const a of mongo.collection("app_usage").find()) {
      if (!a.userId || !a.app || !a.day) continue;
      await ins(
        "appUsage",
        `INSERT INTO app_usage (user_id, app, day, count, first_at, last_at, expire_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [hex(a.userId), a.app, a.day, a.count ?? 0, a.firstAt ?? null, a.lastAt ?? null, a.expireAt ?? new Date(Date.parse(a.day) + 180 * 86_400_000)]
      );
    }

    for await (const a of mongo.collection("admin_audit").find()) {
      await ins("adminAudit", `INSERT INTO admin_audit (type, by_id, by_email, at, request_id, ip, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        a.type ?? "UNKNOWN",
        hex(a.by),
        a.byEmail ?? null,
        a.at ?? new Date(),
        a.requestId ?? null,
        a.ip ?? null,
        a.metadata ?? null,
      ]);
    }

    // Organizations made before the directory (in Continuum's MongoDB)
    const known = new Set((await c.query(`SELECT id FROM users`)).rows.map((r) => r.id));
    for (const o of await mongo.collection("orgs").find().toArray()) {
      const id = hex(o._id);
      await ins("users", `INSERT INTO users (id, kind, display_name, owner_id, created_at) VALUES ($1, 'org', $2, $3, COALESCE($4, now())) ON CONFLICT DO NOTHING`, [id, o.name, known.has(hex(o.createdBy)) ? hex(o.createdBy) : null, o.createdAt ?? null]);
      await ins("orgs", `INSERT INTO orgs (id, name, created_by, created_at, updated_at) VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($5, now())) ON CONFLICT DO NOTHING`, [id, o.name, hex(o.createdBy), o.createdAt ?? null, o.updatedAt ?? null]);
      known.add(id);
    }
    for (const d of await mongo.collection("departments").find().toArray()) {
      const id = hex(d._id);
      if (!known.has(hex(d.orgId))) continue;
      await ins("users", `INSERT INTO users (id, kind, display_name, owner_id, created_at) VALUES ($1, 'department', $2, $3, COALESCE($4, now())) ON CONFLICT DO NOTHING`, [id, d.name, hex(d.orgId), d.createdAt ?? null]);
      await ins("departments", `INSERT INTO departments (id, org_id, name, created_by, created_at) VALUES ($1, $2, $3, $4, COALESCE($5, now())) ON CONFLICT DO NOTHING`, [id, hex(d.orgId), d.name, hex(d.createdBy), d.createdAt ?? null]);
    }
    for (const m of await mongo.collection("org_members").find().toArray()) {
      if (!known.has(hex(m.orgId)) || !known.has(hex(m.userId))) continue;
      await ins("orgMembers", `INSERT INTO org_members (org_id, user_id, org_role, added_by, created_at) VALUES ($1, $2, $3, $4, COALESCE($5, now())) ON CONFLICT DO NOTHING`, [
        hex(m.orgId),
        hex(m.userId),
        ROLES.includes(m.orgRole) ? m.orgRole : "viewer",
        hex(m.addedBy),
        m.createdAt ?? null,
      ]);
      for (const dep of m.departmentIds ?? []) {
        await c.query(
          `INSERT INTO member_departments (org_id, user_id, department_id) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM departments WHERE id = $3) ON CONFLICT DO NOTHING`,
          [hex(m.orgId), hex(m.userId), hex(dep)]
        );
      }
    }
    for (const i of await mongo.collection("org_invites").find().toArray()) {
      if (!known.has(hex(i.orgId))) continue;
      await ins("orgInvites", `INSERT INTO org_invites (id, org_id, email, org_role, department_ids, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8) ON CONFLICT DO NOTHING`, [
        hex(i._id),
        hex(i.orgId),
        i.email,
        ROLES.includes(i.orgRole) ? i.orgRole : "member",
        (i.departmentIds ?? []).map(hex),
        hex(i.invitedBy),
        i.createdAt ?? null,
        i.expiresAt ?? new Date(),
      ]);
    }

    await c.query(`INSERT INTO settings (key, value) VALUES ('mongo_import', $1)`, [{ at: new Date(), counts }]);
  });
  log?.info?.({ counts }, "Directory: imported from Continuum's MongoDB (nothing there was changed)");
  return { skipped: false, counts };
}
