// src/sync/sync.routes.js
//
// Production sync (see sync.service.js):
//   POST /me/sync-codes       a one-time code for your own account (10 minutes, once): created on production
//   POST /admin/sync/preview  what Merge would send from here (admins)
//   POST /admin/sync/push     { target, code } sends it to production (admins)
//   POST /sync/import         production: an account's records with its code (X-Sync-Code), added only
// /sync/import has its own body parser (larger than the app's 1 MB), a limit per address, and every
// attempt is kept in admin_audit.

import express from "express";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { countsOf, createSyncCode, EJSON, exportAccount, importWithCode, pushToProduction } from "./sync.service.js";

const IMPORT_LIMIT = "25mb";
/** Sync attempts per address per hour (a code is single-use; this slows guessing and floods). */
const PER_HOUR = 10;
const tries = new Map(); // ip → [times]

function rateLimited(ip) {
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  tries.set(ip, recent);
  return recent.length > PER_HOUR;
}

const audit = (req, type, metadata) =>
  getDB()
    .collection("admin_audit")
    .insertOne({ type, by: req.user?.id ?? null, byEmail: metadata?.account ?? req.access?.email ?? null, at: new Date(), requestId: req.id ?? null, ip: req.ip ?? null, metadata })
    .catch((err) => req.log?.warn?.({ err: err.message }, "Sync not recorded"));

/** POST /me/sync-codes (signed in): a code for your own account. */
export function createSyncCodeRoute() {
  return async (req, res, next) => {
    try {
      const r = await createSyncCode(req.user.id);
      await audit(req, "SYNC_CODE_CREATED", { expiresAt: r.expiresAt });
      res.set("Cache-Control", "no-store").status(201).json(r);
    } catch (err) {
      next(err);
    }
  };
}

/** /admin/sync (admins, behind authed + the admin feature): Preview and Merge into production. */
export function createSyncAdminRouter() {
  const router = express.Router();
  router.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));
  router.post("/preview", async (req, res) => res.json(countsOf(await exportAccount(req.user.id))));
  router.post("/push", async (req, res) => {
    const { target, code } = req.body ?? {};
    const out = await pushToProduction(req.user.id, target, code);
    await audit(req, "SYNC_PUSHED", { target: String(target).slice(0, 200), sent: out.sent });
    res.json(out);
  });
  return router;
}

/** /sync (public, before the app's JSON parser): production receives an account's records with its code. */
export function createSyncPublicRouter() {
  const router = express.Router();
  router.post("/import", express.text({ type: "application/json", limit: IMPORT_LIMIT }), async (req, res, next) => {
    try {
      if (rateLimited(req.ip ?? "unknown")) throw new AppError("Too many syncs from here; try again in an hour.", 429, "RATE_LIMITED");
      let payload;
      try {
        payload = EJSON.parse(typeof req.body === "string" ? req.body : "", { relaxed: false });
      } catch {
        throw new AppError("The sync couldn't be read.", 400, "VALIDATION_ERROR");
      }
      const report = await importWithCode(req.get("x-sync-code"), payload);
      await audit(req, "SYNC_IMPORTED", { account: report.account, continuum: report.continuum, notes: report.notes });
      res.set("Cache-Control", "no-store").json(report);
    } catch (err) {
      if (err?.code === "SYNC_CODE_INVALID") await audit(req, "SYNC_REFUSED", { reason: err.message });
      next(err);
    }
  });
  return router;
}
