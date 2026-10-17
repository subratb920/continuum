// src/admin/admin.routes.js
//
// The admin area (the admin feature only):
//   GET    /admin/features                       every feature a role can switch
//   GET    /admin/users?search=&role=&status=&seenDays=&sort=&page=
//   GET    /admin/users/:id                      one user: sign-ins, apps used, projects
//   PATCH  /admin/users/:id {roleId?, disabled?}
//   GET    /admin/roles   POST /admin/roles {name, description?, features}
//   PATCH  /admin/roles/:id {name?, description?, features?}
//   DELETE /admin/roles/:id?moveTo=              its users move to another role
//   GET    /admin/settings   PUT /admin/settings {defaultRoleId}
//   GET    /admin/activity?limit=&failed=1       recent sign-ins (everyone)
//   GET    /admin/changes?limit=                 what admins changed, newest first
// Every change is recorded in admin_audit (who, what, before and after): always
// on, unlike the general audit log (AUDIT_LOGGING).

import express from "express";
import { getDB } from "../config/db.js";
import { AUDIT_EVENTS } from "../audit/audit.types.js";
import { createAdminService } from "./admin.service.js";

export function createAdminRouter(opts = {}) {
  const router = express.Router();
  const db = () => opts.db?.() ?? getDB();
  const svc = () => createAdminService(db(), opts);
  // An admin's change, kept (a failure to record never undoes or blocks it)
  const audit = (req, type, metadata) =>
    db()
      .collection("admin_audit")
      .insertOne({ type, by: req.user.id, byEmail: req.access?.email ?? null, at: new Date(), requestId: req.id ?? null, ip: req.ip ?? null, metadata })
      .catch((err) => req.log?.warn?.({ err: err.message }, "Admin change not recorded"));

  router.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));

  router.get("/features", (_req, res) => res.json(svc().features()));

  router.get("/users", async (req, res) => {
    const { search, role, status, seenDays, sort, page } = req.query;
    res.json(await svc().listUsers({ search, role, status, seenDays, sort, page }));
  });
  router.get("/users/:id", async (req, res) => res.json(await svc().getUser(req.params.id)));
  router.patch("/users/:id", async (req, res) => {
    const r = await svc().updateUser(req.user.id, req.params.id, req.body ?? {});
    await audit(req, AUDIT_EVENTS.ADMIN_USER_UPDATED, { target: req.params.id, email: r.user.email, before: r.before, after: r.after });
    res.json(r.user);
  });

  router.get("/roles", async (_req, res) => res.json(await svc().listRoles()));
  router.post("/roles", async (req, res) => {
    const role = await svc().createRole(req.body ?? {});
    await audit(req, AUDIT_EVENTS.ADMIN_ROLE_CREATED, { role: role.id, name: role.name, features: role.features });
    res.status(201).json(role);
  });
  router.patch("/roles/:id", async (req, res) => {
    const r = await svc().updateRole(req.params.id, req.body ?? {});
    await audit(req, AUDIT_EVENTS.ADMIN_ROLE_UPDATED, { role: req.params.id, before: r.before, after: { name: r.role.name, features: r.role.features } });
    res.json(r.role);
  });
  router.delete("/roles/:id", async (req, res) => {
    const r = await svc().deleteRole(req.params.id, req.query.moveTo || undefined);
    await audit(req, AUDIT_EVENTS.ADMIN_ROLE_DELETED, r);
    res.json(r);
  });

  router.get("/settings", async (_req, res) => res.json(await svc().getSettings()));
  router.put("/settings", async (req, res) => {
    const s = await svc().setSettings(req.body ?? {});
    await audit(req, AUDIT_EVENTS.ADMIN_SETTINGS_UPDATED, { defaultRoleId: s.defaultRoleId });
    res.json(s);
  });

  router.get("/activity", async (req, res) => res.json(await svc().activity({ limit: req.query.limit, failedOnly: req.query.failed === "1" })));
  router.get("/changes", async (req, res) => {
    const n = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const list = await db().collection("admin_audit").find().sort({ at: -1 }).limit(n).toArray();
    res.json(list.map(({ _id, by, ...c }) => ({ id: String(_id), by: String(by), ...c })));
  });

  return router;
}
