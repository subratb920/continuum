// continuum-directory/server/src/api/router.js
//
// The directory's HTTP API, mounted by the host at /directory. The host hands
// in `auth`: middleware that signs the request in (req.user.id) and loads the
// user's access (req.access, from this directory's accessFor).
//
//   GET    /me                                   you: kind, role, features, your mappings
//   GET    /me/spaces                            your spaces (personal + organizations), last used, invites
//   PUT    /me/spaces/active { spaceId }         the space you last used (opened next time, any device)
//   POST   /me/invites/:id/accept | /decline
//   POST   /orgs { name }                        a new organization (you're its owner)
//   GET    /orgs/:orgId   PATCH { name }   DELETE
//   POST   /orgs/:orgId/departments { name }   PATCH|DELETE /orgs/:orgId/departments/:id
//   PATCH  /orgs/:orgId/members/:userId { orgRole?, departmentIds? }   DELETE (remove, or leave)
//   POST   /orgs/:orgId/invites { email, orgRole, departmentIds }   DELETE /orgs/:orgId/invites/:id
//   /admin/*  (Continuum's admins: the "admin" feature)
//     GET /admin/features   GET /admin/users?kind=&search=&role=&status=&seenDays=&sort=&page=
//     GET|PATCH /admin/users/:id   POST /admin/users/:id/signout
//     GET|POST /admin/roles   PATCH|DELETE /admin/roles/:id?moveTo=
//     GET|PUT /admin/settings   GET /admin/activity?limit=&failed=1   GET /admin/changes?limit=
//
// Every change is recorded: organizations' in directory_audit, admins' in
// admin_audit (who, what, before and after).

import express from "express";
import { DirectoryError } from "../errors.js";

export function createDirectoryRouter({ directory, auth = [] }) {
  const { orgs, admin, links, users, activity } = directory.parts;
  const router = express.Router();

  router.use(express.json({ limit: "100kb" }));
  router.use(...auth);
  router.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));

  const orgChange = (req, type, orgId, metadata) =>
    orgs
      .recordChange({ type, userId: req.user.id, orgId, requestId: req.id, ip: req.ip, userAgent: req.get("user-agent"), metadata })
      .catch((err) => req.log?.warn?.({ err: err.message, type }, "Organization change not recorded"));
  const adminChange = (req, type, metadata) =>
    admin
      .recordChange({ type, byId: req.user.id, byEmail: req.access?.email ?? null, requestId: req.id, ip: req.ip, metadata })
      .catch((err) => req.log?.warn?.({ err: err.message, type }, "Admin change not recorded"));

  // ── You ─────────────────────────────────────────────────────

  router.get("/me", async (req, res) => {
    const a = req.access;
    res.json({
      id: a.userId,
      kind: a.kind,
      email: a.email,
      role: a.role,
      features: a.features,
      isAdmin: a.isAdmin,
      links: await links.linksOf(a.userId),
      // No admin yet: the page offers to claim it with the setup code (from the host's log)
      ...(a.isAdmin ? {} : { adminSetup: await users.adminSetupOpen() }),
    });
  });
  router.get("/me/spaces", async (req, res) => res.json(await orgs.spacesFor(req.user.id)));
  router.put("/me/spaces/active", async (req, res) => {
    await orgs.setLastSpace(req.user.id, req.body?.spaceId);
    res.status(204).end();
  });
  router.post("/me/invites/:inviteId/accept", async (req, res) => {
    const joined = await orgs.acceptInvite(req.user.id, req.params.inviteId);
    await orgChange(req, "ORG_INVITE_ACCEPTED", joined.orgId, { inviteId: req.params.inviteId });
    res.json(joined);
  });
  router.post("/me/invites/:inviteId/decline", async (req, res) => {
    await orgs.declineInvite(req.user.id, req.params.inviteId);
    res.status(204).end();
  });

  // ── Organizations ───────────────────────────────────────────

  router.post("/orgs", async (req, res) => {
    const org = await orgs.createOrg(req.user.id, req.body?.name);
    await orgChange(req, "ORG_CREATED", org.orgId, { name: org.name });
    res.status(201).json(org);
  });
  router.get("/orgs/:orgId", async (req, res) => res.json(await orgs.getOrg(req.params.orgId, req.user.id)));
  router.patch("/orgs/:orgId", async (req, res) => {
    const r = await orgs.renameOrg(req.params.orgId, req.user.id, req.body?.name);
    await orgChange(req, "ORG_UPDATED", req.params.orgId, { name: r.name });
    res.json(r);
  });
  router.delete("/orgs/:orgId", async (req, res) => {
    await orgs.deleteOrg(req.params.orgId, req.user.id);
    await orgChange(req, "ORG_DELETED", req.params.orgId, {});
    res.status(204).end();
  });
  router.post("/orgs/:orgId/departments", async (req, res) => {
    const d = await orgs.addDepartment(req.params.orgId, req.user.id, req.body?.name);
    await orgChange(req, "ORG_DEPARTMENT_ADDED", req.params.orgId, { departmentId: d.id, name: d.name });
    res.status(201).json(d);
  });
  router.patch("/orgs/:orgId/departments/:departmentId", async (req, res) => {
    const d = await orgs.renameDepartment(req.params.orgId, req.user.id, req.params.departmentId, req.body?.name);
    await orgChange(req, "ORG_DEPARTMENT_UPDATED", req.params.orgId, { departmentId: d.id, name: d.name });
    res.json(d);
  });
  router.delete("/orgs/:orgId/departments/:departmentId", async (req, res) => {
    await orgs.deleteDepartment(req.params.orgId, req.user.id, req.params.departmentId);
    await orgChange(req, "ORG_DEPARTMENT_DELETED", req.params.orgId, { departmentId: req.params.departmentId });
    res.status(204).end();
  });
  router.patch("/orgs/:orgId/members/:userId", async (req, res) => {
    const m = await orgs.updateMember(req.params.orgId, req.user.id, req.params.userId, { orgRole: req.body?.orgRole, departmentIds: req.body?.departmentIds });
    await orgChange(req, "ORG_MEMBER_UPDATED", req.params.orgId, { member: m.userId, orgRole: m.orgRole, departmentIds: m.departmentIds });
    res.json(m);
  });
  router.delete("/orgs/:orgId/members/:userId", async (req, res) => {
    await orgs.removeMember(req.params.orgId, req.user.id, req.params.userId);
    await orgChange(req, "ORG_MEMBER_REMOVED", req.params.orgId, { member: req.params.userId, left: req.params.userId === String(req.user.id) });
    res.status(204).end();
  });
  router.post("/orgs/:orgId/invites", async (req, res) => {
    const inv = await orgs.invite(req.params.orgId, req.user.id, req.body ?? {});
    await orgChange(req, "ORG_INVITED", req.params.orgId, { inviteId: inv.id, email: inv.email, orgRole: inv.orgRole });
    res.status(201).json(inv);
  });
  router.delete("/orgs/:orgId/invites/:inviteId", async (req, res) => {
    await orgs.cancelInvite(req.params.orgId, req.user.id, req.params.inviteId);
    await orgChange(req, "ORG_INVITE_CANCELLED", req.params.orgId, { inviteId: req.params.inviteId });
    res.status(204).end();
  });

  // ── Continuum's admins ──────────────────────────────────────

  const adminOnly = express.Router();
  adminOnly.use((req, res, next) =>
    req.access?.features?.includes("admin") ? next() : res.status(403).json({ error: "No feature access: Admin isn't switched on for your role. Ask your admin.", code: "NO_FEATURE_ACCESS", feature: "admin" })
  );
  adminOnly.get("/features", (_req, res) => res.json(admin.features()));
  adminOnly.get("/users", async (req, res) => {
    const { kind, search, role, status, seenDays, sort, page } = req.query;
    res.json(await admin.listUsers({ kind, search, role, status, seenDays, sort, page }));
  });
  adminOnly.get("/users/:id", async (req, res) => res.json(await admin.getUser(req.params.id)));
  adminOnly.patch("/users/:id", async (req, res) => {
    const r = await admin.updateUser(req.user.id, req.params.id, req.body ?? {});
    await adminChange(req, "ADMIN_USER_UPDATED", { target: req.params.id, email: r.user.email, before: r.before, after: r.after });
    res.json(r.user);
  });
  adminOnly.post("/users/:id/signout", async (req, res) => {
    const r = await admin.signOut(req.params.id);
    await adminChange(req, "ADMIN_USER_SIGNED_OUT", { target: req.params.id, ...r });
    res.json(r);
  });
  adminOnly.get("/roles", async (_req, res) => res.json(await admin.listRoles()));
  adminOnly.post("/roles", async (req, res) => {
    const role = await admin.createRole(req.body ?? {});
    await adminChange(req, "ADMIN_ROLE_CREATED", { role: role.id, name: role.name, features: role.features });
    res.status(201).json(role);
  });
  adminOnly.patch("/roles/:id", async (req, res) => {
    const r = await admin.updateRole(req.params.id, req.body ?? {});
    await adminChange(req, "ADMIN_ROLE_UPDATED", { role: req.params.id, before: r.before, after: { name: r.role.name, features: r.role.features } });
    res.json(r.role);
  });
  adminOnly.delete("/roles/:id", async (req, res) => {
    const r = await admin.deleteRole(req.params.id, req.query.moveTo || undefined);
    await adminChange(req, "ADMIN_ROLE_DELETED", r);
    res.json(r);
  });
  adminOnly.get("/settings", async (_req, res) => res.json(await admin.getSettings()));
  adminOnly.put("/settings", async (req, res) => {
    const s = await admin.setSettings(req.body ?? {});
    await adminChange(req, "ADMIN_SETTINGS_UPDATED", { defaultRoleId: s.defaultRoleId });
    res.json(s);
  });
  adminOnly.get("/activity", async (req, res) => res.json(await admin.activity({ limit: req.query.limit, failedOnly: req.query.failed === "1" })));
  // Public-site visitor analytics (anonymous; no person identified)
  adminOnly.get("/visits", async (req, res) => res.json(await activity.visitStats({ from: req.query.from, to: req.query.to })));
  adminOnly.get("/visits/journeys", async (req, res) => res.json(await activity.visitorJourneys({ from: req.query.from, to: req.query.to })));
  adminOnly.get("/changes", async (req, res) => res.json(await admin.changes({ limit: req.query.limit })));
  router.use("/admin", adminOnly);

  // The first admin, with the setup code from the host's log (while there's none)
  const claimTries = new Map(); // userId → [times]
  router.post("/me/claim-admin", async (req, res) => {
    const key = String(req.user.id);
    const now = Date.now();
    const recent = (claimTries.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
    if (recent.length >= 5) return res.status(429).json({ error: "Too many tries. Wait 15 minutes.", code: "TOO_MANY_TRIES" });
    claimTries.set(key, [...recent, now]);
    const ok = await users.claimAdmin(req.user.id, typeof req.body?.code === "string" ? req.body.code : "");
    if (!ok) return res.status(400).json({ error: "That code isn't right, has expired, or there's an admin already.", code: "BAD_SETUP_CODE" });
    claimTries.delete(key);
    await adminChange(req, "ADMIN_CLAIMED", { email: req.access?.email ?? null });
    res.json({ isAdmin: true });
  });

  // The directory's own errors answer as they are; anything else is the host's to handle
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof DirectoryError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.field ? { field: err.field } : {}) });
    next(err);
  });

  return router;
}
