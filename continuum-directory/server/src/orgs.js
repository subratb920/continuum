// continuum-directory/server/src/orgs.js
//
// Organizations: their members (each with an organization role and
// departments), departments and invites (by email; whoever signs in with that
// email sees it and can join). An organization and each department are also
// users (kind org / department). Who may do what:
//   owner  — everything, including other owners and deleting the organization
//   admin  — name, departments, invites and members (not owners, not making owners)
//   member — works on the projects of their departments (and those in none)
//   viewer — only looks
// None of these is a Continuum role: an organization's admin is never
// Continuum's admin (that's only users.role_id).
//
// Spaces: where a user works. Their personal space ("u:<id>") and each
// organization they're in ("o:<org id>").

import { tx } from "./db/pool.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { isId, newId } from "./ids.js";

export const ORG_ROLES = ["owner", "admin", "member", "viewer"];

const MAX_NAME = 80;
const MAX_ORGS_OWNED = 20;
const MAX_MEMBERS = 500;
const MAX_DEPARTMENTS = 100;
const INVITE_DAYS = 14;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const personalSpaceId = (userId) => `u:${userId}`;
export const orgSpaceId = (orgId) => `o:${orgId}`;

/** "u:<id>" or "o:<id>" → { kind, ref }, else null. */
export function parseSpace(value) {
  const m = /^([uo]):([a-f0-9]{24})$/.exec(String(value ?? "").trim());
  return m ? { kind: m[1] === "u" ? "user" : "org", ref: m[2] } : null;
}

function cleanName(name, what) {
  if (typeof name !== "string" || !name.trim()) throw badRequest(`${what} name is required.`);
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length > MAX_NAME) throw badRequest(`${what} name must be ${MAX_NAME} characters or fewer.`);
  return n;
}

function cleanRole(role) {
  if (!ORG_ROLES.includes(role)) throw badRequest(`The role must be one of: ${ORG_ROLES.join(", ")}.`);
  return role;
}

const isUnique = (err) => err?.code === "23505";

export function createOrgs({ pool, hooks = {} }) {
  const q = (sql, params) => pool.query(sql, params);
  const countProjects = (filter) => (hooks.countProjects ? hooks.countProjects(filter) : Promise.resolve(0));

  async function membership(orgId, userId) {
    if (!isId(orgId)) throw notFound("That organization");
    const m = (await q(`SELECT * FROM org_members WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(userId)])).rows[0];
    if (!m) throw notFound("That organization");
    return m;
  }

  async function requireManager(orgId, userId) {
    const m = await membership(orgId, userId);
    if (m.org_role !== "owner" && m.org_role !== "admin") throw forbidden("Only the organization's owners and admins can do that.", "NOT_ORG_ADMIN");
    return m;
  }

  const departmentsOf = async (orgId, userId) =>
    (await q(`SELECT department_id FROM member_departments WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(userId)])).rows.map((r) => r.department_id);

  /** Departments must be this organization's (undefined: not given). */
  async function cleanDepartments(orgId, ids) {
    if (ids === undefined) return undefined;
    if (!Array.isArray(ids) || ids.some((d) => !isId(d))) throw badRequest("Departments must be a list of department ids.");
    const want = [...new Set(ids.map(String))];
    if (!want.length) return [];
    const found = (await q(`SELECT count(*)::int AS n FROM departments WHERE org_id = $1 AND id = ANY($2)`, [String(orgId), want])).rows[0].n;
    if (found !== want.length) throw badRequest("A department isn't this organization's.");
    return want;
  }

  /**
   * The space a request works in: personal unless it names an organization
   * the user is a member of. Naming someone else's space is refused (403 NOT_IN_SPACE).
   * → { id, kind: "user" | "org", orgId?, orgRole?, departmentIds? }
   */
  async function resolveSpace(userId, header) {
    const me = String(userId);
    if (!header) return { id: personalSpaceId(me), kind: "user" };
    const s = parseSpace(header);
    if (!s) throw badRequest("That isn't a space.", "BAD_SPACE");
    if (s.kind === "user") {
      if (s.ref !== me) throw forbidden("That space isn't yours.", "NOT_IN_SPACE");
      return { id: personalSpaceId(me), kind: "user" };
    }
    const m = (await q(`SELECT org_role FROM org_members WHERE org_id = $1 AND user_id = $2`, [s.ref, me])).rows[0];
    if (!m) throw forbidden("You're not a member of that organization.", "NOT_IN_SPACE");
    return { id: orgSpaceId(s.ref), kind: "org", orgId: s.ref, orgRole: ORG_ROLES.includes(m.org_role) ? m.org_role : "viewer", departmentIds: await departmentsOf(s.ref, me) };
  }

  /** A user's spaces: personal, then each organization they're in (with their role there), the one last used, and invites to their email. */
  async function spacesFor(userId) {
    const me = String(userId);
    const { rows } = await q(
      `SELECT o.id, o.name, m.org_role,
         COALESCE(array_agg(md.department_id) FILTER (WHERE md.department_id IS NOT NULL), '{}') AS department_ids
       FROM org_members m JOIN orgs o ON o.id = m.org_id
       LEFT JOIN member_departments md ON md.org_id = m.org_id AND md.user_id = m.user_id
       WHERE m.user_id = $1 GROUP BY o.id, o.name, m.org_role ORDER BY lower(o.name)`,
      [me]
    );
    const user = (await q(`SELECT email, last_space_id FROM users WHERE id = $1`, [me])).rows[0];
    const spaces = [
      { id: personalSpaceId(me), kind: "user", name: "Personal" },
      ...rows.map((o) => ({ id: orgSpaceId(o.id), kind: "org", orgId: o.id, name: o.name, orgRole: o.org_role, departmentIds: o.department_ids })),
    ];
    const last = spaces.find((s) => s.id === user?.last_space_id)?.id ?? spaces[0].id;
    return { spaces, lastSpaceId: last, invites: user?.email ? await invitesForEmail(user.email) : [] };
  }

  async function setLastSpace(userId, spaceId) {
    const s = parseSpace(spaceId);
    if (!s) throw badRequest("That isn't a space.", "BAD_SPACE");
    if (s.kind === "user" && s.ref !== String(userId)) throw forbidden("That space isn't yours.", "NOT_IN_SPACE");
    if (s.kind === "org") await membership(s.ref, userId);
    await q(`UPDATE users SET last_space_id = $2 WHERE id = $1`, [String(userId), spaceId]);
  }

  async function createOrg(userId, name) {
    const n = cleanName(name, "Organization");
    const me = String(userId);
    const owned = (await q(`SELECT count(*)::int AS n FROM org_members WHERE user_id = $1 AND org_role = 'owner'`, [me])).rows[0].n;
    if (owned >= MAX_ORGS_OWNED) throw badRequest(`You can own at most ${MAX_ORGS_OWNED} organizations.`, "TOO_MANY_ORGS");
    const id = newId();
    await tx(pool, async (c) => {
      await c.query(`INSERT INTO users (id, kind, display_name, owner_id) VALUES ($1, 'org', $2, $3)`, [id, n, me]);
      await c.query(`INSERT INTO orgs (id, name, created_by) VALUES ($1, $2, $3)`, [id, n, me]);
      await c.query(`INSERT INTO org_members (org_id, user_id, org_role, added_by) VALUES ($1, $2, 'owner', $2)`, [id, me]);
    });
    return { id: orgSpaceId(id), orgId: id, name: n, orgRole: "owner" };
  }

  /** The organization as a member sees it: members and departments; invites for its owners and admins. */
  async function getOrg(orgId, userId) {
    const me = await membership(orgId, userId);
    const org = (await q(`SELECT * FROM orgs WHERE id = $1`, [String(orgId)])).rows[0];
    if (!org) throw notFound("That organization");
    const members = (
      await q(
        `SELECT m.user_id, m.org_role, m.created_at, u.kind, u.email, u.display_name,
           COALESCE(array_agg(md.department_id) FILTER (WHERE md.department_id IS NOT NULL), '{}') AS department_ids
         FROM org_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN member_departments md ON md.org_id = m.org_id AND md.user_id = m.user_id
         WHERE m.org_id = $1 GROUP BY m.user_id, m.org_role, m.created_at, u.kind, u.email, u.display_name
         ORDER BY m.created_at`,
        [org.id]
      )
    ).rows;
    const manages = me.org_role === "owner" || me.org_role === "admin";
    return {
      id: orgSpaceId(org.id),
      orgId: org.id,
      name: org.name,
      createdAt: org.created_at,
      orgRole: me.org_role,
      members: members.map((m) => ({ userId: m.user_id, kind: m.kind, email: m.email ?? null, name: m.display_name ?? null, orgRole: m.org_role, departmentIds: m.department_ids, since: m.created_at })),
      departments: (await q(`SELECT id, name FROM departments WHERE org_id = $1 ORDER BY lower(name)`, [org.id])).rows,
      projects: await countProjects({ spaceId: orgSpaceId(org.id) }),
      ...(manages ? { invites: (await q(`SELECT * FROM org_invites WHERE org_id = $1 ORDER BY created_at DESC`, [org.id])).rows.map(inviteView) } : {}),
    };
  }

  async function renameOrg(orgId, userId, name) {
    await requireManager(orgId, userId);
    const n = cleanName(name, "Organization");
    await q(`UPDATE orgs SET name = $2, updated_at = now() WHERE id = $1`, [String(orgId), n]);
    await q(`UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`, [String(orgId), n]);
    return { name: n };
  }

  /** Only an owner, and only while it has no projects (nothing of anyone's is lost). */
  async function deleteOrg(orgId, userId) {
    const me = await membership(orgId, userId);
    if (me.org_role !== "owner") throw forbidden("Only the organization's owners can delete it.", "NOT_ORG_OWNER");
    const left = await countProjects({ spaceId: orgSpaceId(orgId) });
    if (left) throw conflict(`It still has ${left} project${left === 1 ? "" : "s"}. Move or delete them first.`, "ORG_HAS_PROJECTS");
    await tx(pool, async (c) => {
      // Its departments and the organization are users too: they go with it (members, invites by cascade)
      await c.query(`DELETE FROM users WHERE id IN (SELECT id FROM departments WHERE org_id = $1)`, [String(orgId)]);
      await c.query(`DELETE FROM users WHERE id = $1 AND kind = 'org'`, [String(orgId)]);
      await c.query(`UPDATE users SET last_space_id = NULL WHERE last_space_id = $1`, [orgSpaceId(orgId)]);
    });
  }

  // ── Departments ─────────────────────────────────────────────

  async function addDepartment(orgId, userId, name) {
    await requireManager(orgId, userId);
    const n = cleanName(name, "Department");
    const count = (await q(`SELECT count(*)::int AS n FROM departments WHERE org_id = $1`, [String(orgId)])).rows[0].n;
    if (count >= MAX_DEPARTMENTS) throw badRequest(`At most ${MAX_DEPARTMENTS} departments.`, "TOO_MANY_DEPARTMENTS");
    const id = newId();
    try {
      await tx(pool, async (c) => {
        await c.query(`INSERT INTO users (id, kind, display_name, owner_id) VALUES ($1, 'department', $2, $3)`, [id, n, String(orgId)]);
        await c.query(`INSERT INTO departments (id, org_id, name, created_by) VALUES ($1, $2, $3, $4)`, [id, String(orgId), n, String(userId)]);
      });
    } catch (err) {
      if (isUnique(err)) throw conflict("There's a department with that name already.", "DEPARTMENT_EXISTS");
      throw err;
    }
    return { id, name: n };
  }

  async function renameDepartment(orgId, userId, departmentId, name) {
    await requireManager(orgId, userId);
    const n = cleanName(name, "Department");
    if (!isId(departmentId)) throw notFound("That department");
    try {
      const r = await q(`UPDATE departments SET name = $3 WHERE id = $1 AND org_id = $2`, [String(departmentId), String(orgId), n]);
      if (!r.rowCount) throw notFound("That department");
    } catch (err) {
      if (isUnique(err)) throw conflict("There's a department with that name already.", "DEPARTMENT_EXISTS");
      throw err;
    }
    await q(`UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`, [String(departmentId), n]);
    return { id: String(departmentId), name: n };
  }

  /** Only while no project is in it (taking it away would show those projects to everyone). */
  async function deleteDepartment(orgId, userId, departmentId) {
    await requireManager(orgId, userId);
    if (!isId(departmentId)) throw notFound("That department");
    const inUse = await countProjects({ spaceId: orgSpaceId(orgId), departmentId: String(departmentId) });
    if (inUse) throw conflict(`${inUse} project${inUse === 1 ? " is" : "s are"} in this department. Take ${inUse === 1 ? "it" : "them"} out first.`, "DEPARTMENT_IN_USE");
    const r = await tx(pool, async (c) => {
      const d = await c.query(`DELETE FROM departments WHERE id = $1 AND org_id = $2`, [String(departmentId), String(orgId)]);
      if (d.rowCount) {
        await c.query(`DELETE FROM users WHERE id = $1 AND kind = 'department'`, [String(departmentId)]);
        await c.query(`UPDATE org_invites SET department_ids = array_remove(department_ids, $2) WHERE org_id = $1`, [String(orgId), String(departmentId)]);
      }
      return d;
    });
    if (!r.rowCount) throw notFound("That department");
  }

  // ── Members ─────────────────────────────────────────────────

  const owners = async (orgId) => (await q(`SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND org_role = 'owner'`, [String(orgId)])).rows[0].n;

  async function setMemberDepartments(c, orgId, userId, ids) {
    await c.query(`DELETE FROM member_departments WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(userId)]);
    for (const d of ids) await c.query(`INSERT INTO member_departments (org_id, user_id, department_id) VALUES ($1, $2, $3)`, [String(orgId), String(userId), d]);
  }

  /** Owners and admins change members; an admin can't touch an owner or make one. There's always an owner. */
  async function updateMember(orgId, userId, memberId, { orgRole, departmentIds } = {}) {
    const me = await requireManager(orgId, userId);
    if (!isId(memberId)) throw notFound("That member");
    const them = (await q(`SELECT * FROM org_members WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(memberId)])).rows[0];
    if (!them) throw notFound("That member");
    let role;
    if (orgRole !== undefined) {
      cleanRole(orgRole);
      if (me.org_role !== "owner" && (them.org_role === "owner" || orgRole === "owner")) throw forbidden("Only owners can change an owner or make someone an owner.", "NOT_ORG_OWNER");
      if (them.org_role === "owner" && orgRole !== "owner" && (await owners(orgId)) <= 1) throw conflict("An organization needs an owner. Make someone else an owner first.", "LAST_OWNER");
      role = orgRole;
    }
    let depts;
    if (departmentIds !== undefined) {
      if (me.org_role !== "owner" && them.org_role === "owner") throw forbidden("Only owners can change an owner.", "NOT_ORG_OWNER");
      depts = await cleanDepartments(orgId, departmentIds);
    }
    if (role === undefined && depts === undefined) throw badRequest("Nothing to change.");
    await tx(pool, async (c) => {
      if (role !== undefined) await c.query(`UPDATE org_members SET org_role = $3, updated_at = now() WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(memberId), role]);
      if (depts !== undefined) await setMemberDepartments(c, orgId, memberId, depts);
    });
    return { userId: String(memberId), orgRole: role ?? them.org_role, departmentIds: depts ?? (await departmentsOf(orgId, memberId)) };
  }

  /** Remove a member (owners and admins; an admin can't remove an owner), or leave (yourself). There's always an owner. Their projects stay the organization's. */
  async function removeMember(orgId, userId, memberId) {
    const self = String(memberId) === String(userId);
    const me = self ? await membership(orgId, userId) : await requireManager(orgId, userId);
    if (!isId(memberId)) throw notFound("That member");
    const them = self ? me : (await q(`SELECT * FROM org_members WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(memberId)])).rows[0];
    if (!them) throw notFound("That member");
    if (!self && me.org_role !== "owner" && them.org_role === "owner") throw forbidden("Only owners can remove an owner.", "NOT_ORG_OWNER");
    if (them.org_role === "owner" && (await owners(orgId)) <= 1) throw conflict("An organization needs an owner. Make someone else an owner first.", "LAST_OWNER");
    await q(`DELETE FROM org_members WHERE org_id = $1 AND user_id = $2`, [String(orgId), String(memberId)]);
    await q(`UPDATE users SET last_space_id = NULL WHERE id = $1 AND last_space_id = $2`, [String(memberId), orgSpaceId(orgId)]);
  }

  // ── Invites ─────────────────────────────────────────────────

  function inviteView(i) {
    return { id: i.id, email: i.email, orgRole: i.org_role, departmentIds: i.department_ids ?? [], createdAt: i.created_at, expiresAt: i.expires_at };
  }

  /** Invite by email (owners and admins; only an owner invites an owner). Inviting the same email again replaces it. */
  async function invite(orgId, userId, { email, orgRole = "member", departmentIds = [] } = {}) {
    const me = await requireManager(orgId, userId);
    const e = String(email ?? "").trim().toLowerCase();
    if (!EMAIL.test(e) || e.length > 254) throw badRequest("That isn't an email address.");
    cleanRole(orgRole);
    if (orgRole === "owner" && me.org_role !== "owner") throw forbidden("Only owners can invite an owner.", "NOT_ORG_OWNER");
    const depts = await cleanDepartments(orgId, departmentIds);
    const already = await q(`SELECT 1 FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND lower(u.email) = $2`, [String(orgId), e]);
    if (already.rowCount) throw conflict("They're a member already.", "ALREADY_MEMBER");
    const members = (await q(`SELECT count(*)::int AS n FROM org_members WHERE org_id = $1`, [String(orgId)])).rows[0].n;
    if (members >= MAX_MEMBERS) throw badRequest(`At most ${MAX_MEMBERS} members.`, "TOO_MANY_MEMBERS");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const { rows } = await q(
      `INSERT INTO org_invites (id, org_id, email, org_role, department_ids, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (org_id, lower(email)) DO UPDATE SET org_role = EXCLUDED.org_role, department_ids = EXCLUDED.department_ids,
         invited_by = EXCLUDED.invited_by, created_at = now(), expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [newId(), String(orgId), e, orgRole, depts, String(userId), expiresAt]
    );
    return inviteView(rows[0]);
  }

  async function cancelInvite(orgId, userId, inviteId) {
    await requireManager(orgId, userId);
    if (!isId(inviteId)) throw notFound("That invite");
    const r = await q(`DELETE FROM org_invites WHERE id = $1 AND org_id = $2`, [String(inviteId), String(orgId)]);
    if (!r.rowCount) throw notFound("That invite");
  }

  /** Invites waiting for this email, with the organization's name. */
  async function invitesForEmail(email) {
    const { rows } = await q(
      `SELECT i.*, o.name AS org_name FROM org_invites i JOIN orgs o ON o.id = i.org_id WHERE lower(i.email) = lower($1) AND i.expires_at > now() ORDER BY i.created_at`,
      [String(email)]
    );
    return rows.map((i) => ({ ...inviteView(i), orgId: i.org_id, orgName: i.org_name }));
  }

  const emailOf = async (userId) => (await q(`SELECT email FROM users WHERE id = $1`, [String(userId)])).rows[0]?.email ?? "";

  /** Join with an invite to your own email: you become a member with its role and departments. */
  async function acceptInvite(userId, inviteId) {
    if (!isId(inviteId)) throw notFound("That invite");
    const inv = (await q(`SELECT * FROM org_invites WHERE id = $1 AND lower(email) = lower($2) AND expires_at > now()`, [String(inviteId), await emailOf(userId)])).rows[0];
    if (!inv) throw notFound("That invite");
    await tx(pool, async (c) => {
      const joined = await c.query(
        `INSERT INTO org_members (org_id, user_id, org_role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [inv.org_id, String(userId), inv.org_role, inv.invited_by]
      );
      // The departments it named may have gone since
      if (joined.rowCount) {
        const depts = (await c.query(`SELECT id FROM departments WHERE org_id = $1 AND id = ANY($2)`, [inv.org_id, inv.department_ids ?? []])).rows.map((r) => r.id);
        await setMemberDepartments(c, inv.org_id, userId, depts);
      }
      await c.query(`DELETE FROM org_invites WHERE id = $1`, [inv.id]);
    });
    return { id: orgSpaceId(inv.org_id), orgId: inv.org_id };
  }

  async function declineInvite(userId, inviteId) {
    if (!isId(inviteId)) throw notFound("That invite");
    const r = await q(`DELETE FROM org_invites WHERE id = $1 AND lower(email) = lower($2)`, [String(inviteId), await emailOf(userId)]);
    if (!r.rowCount) throw notFound("That invite");
  }

  /** What changed in an organization, kept (a failure to record never undoes or blocks it). */
  async function recordChange({ type, userId, orgId, requestId, ip, userAgent, metadata }) {
    await q(`INSERT INTO directory_audit (type, user_id, org_id, request_id, ip, user_agent, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      type,
      userId ? String(userId) : null,
      orgId ? String(orgId) : null,
      requestId ?? null,
      ip ?? null,
      userAgent ?? null,
      metadata ?? null,
    ]);
  }

  return {
    resolveSpace,
    spacesFor,
    setLastSpace,
    createOrg,
    getOrg,
    renameOrg,
    deleteOrg,
    addDepartment,
    renameDepartment,
    deleteDepartment,
    updateMember,
    removeMember,
    invite,
    cancelInvite,
    acceptInvite,
    declineInvite,
    cleanDepartments,
    recordChange,
  };
}
