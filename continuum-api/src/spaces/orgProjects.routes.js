// src/spaces/orgProjects.routes.js
//
// An organization's projects as the Directory's page shows them (projects are
// Continuum's, so they're answered here, next to the directory's own routes):
//   GET /directory/orgs/:orgId/projects                           the ones you see there
//   PUT /directory/orgs/:orgId/projects/:projectId/departments    { departmentIds } which departments see it
// Who sees and may change what follows the organization's roles (projectAccess.js).

import express from "express";
import { getDB } from "../config/db.js";
import { dir } from "../directory/directory.js";
import { projectFilter } from "./projectAccess.js";
import { createProjectService } from "../services/project.service.js";
import { createAuditService } from "../audit/audit.service.js";
import { AUDIT_EVENTS } from "../audit/audit.types.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";

export function createOrgProjectsRouter() {
  const router = express.Router({ mergeParams: true });
  // The organization as your space (403 NOT_IN_SPACE when you're not in it)
  router.use(async (req, _res, next) => {
    try {
      req.space = await dir.resolveSpace(String(req.user.id), `o:${req.params.orgId}`);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res) => {
    const list = await getDB()
      .collection(PROJECT_COLLECTION)
      .find(projectFilter(req.space, req.user.id), { projection: { name: 1, source: 1, userId: 1, departmentIds: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
    res.set("Cache-Control", "no-store").json(list.map((p) => ({ id: String(p._id), name: p.name, source: p.source, userId: p.userId ? String(p.userId) : null, departmentIds: (p.departmentIds ?? []).map(String) })));
  });

  router.put("/:projectId/departments", async (req, res) => {
    const db = getDB();
    const r = await (await createProjectService(db)).setProjectDepartments(req.user.id, req.params.projectId, req.body?.departmentIds, req.space);
    await createAuditService(db)
      .logEvent({ type: AUDIT_EVENTS.PROJECT_DEPARTMENTS_SET, userId: req.user.id, projectId: req.params.projectId, requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"], metadata: { spaceId: req.space.id, departmentIds: r.departmentIds } })
      .catch(() => {});
    res.json(r);
  });

  return router;
}
