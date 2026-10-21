import express from "express";
import { getDB } from "../config/db.js";
import { createSupportService } from "../services/supportRequests.js";

const router = express.Router();

// Contact us → Request a callback (signed-in users)
router.post("/callbacks", async (req, res) => {
  const support = createSupportService(getDB(), { log: req.log });
  const saved = await support.requestCallback(req.user, req.body);
  req.log.info({ userId: req.user.id, requestId: String(saved.id), bestTime: saved.bestTime }, "Callback requested");
  res.status(201).json({ id: saved.id, bestTime: saved.bestTime, createdAt: saved.createdAt });
});

export default router;

/**
 * The team's side (the Directory's Callback requests; Continuum's admins):
 *   GET   /directory/admin/callbacks?status=new|called
 *   PATCH /directory/admin/callbacks/:id { status: "called" | "new" }
 */
export function createCallbacksAdminRouter() {
  const admin = express.Router();
  admin.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await createSupportService(getDB()).listCallbacks({ status: req.query.status, limit: req.query.limit }));
  });
  admin.patch("/:id", async (req, res) => {
    const r = await createSupportService(getDB()).setCallbackStatus(req.params.id, req.body?.status, { email: req.access?.email ?? null });
    req.log.info({ requestId: r.id, status: r.status, by: req.user.id }, "Callback request marked");
    res.json(r);
  });
  return admin;
}

/**
 * The team's side for public-site leads (Continuum's admins):
 *   GET   /directory/admin/leads?status=new|contacted
 *   PATCH /directory/admin/leads/:id { status: "contacted" | "new" }
 */
export function createLeadsAdminRouter() {
  const admin = express.Router();
  admin.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await createSupportService(getDB()).listLeads({ status: req.query.status, limit: req.query.limit }));
  });
  admin.patch("/:id", async (req, res) => {
    const r = await createSupportService(getDB()).setLeadStatus(req.params.id, req.body?.status, { email: req.access?.email ?? null });
    req.log.info({ requestId: r.id, status: r.status, by: req.user.id }, "Lead marked");
    res.json(r);
  });
  return admin;
}
