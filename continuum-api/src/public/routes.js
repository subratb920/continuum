// src/public/routes.js
//
// Public, unauthenticated endpoints the marketing site (continuum-site) calls
// straight from a visitor's browser. No sign-in, no cookies.
//   POST /public/visits  a real browser confirming a page view (+ a little
//                        enrichment: screen, timezone, language). Anonymous.
//   POST /public/leads   an interested visitor leaving an email, so they can
//                        become a known contact (→ support_requests, emailed).
//
// CORS for the public site's origin is allowed in middleware/cors.middleware.js
// (PUBLIC_SITE_ORIGINS). Both routes are softly rate-limited by IP in memory.

import express from "express";
import { getDB } from "../config/db.js";
import { dir } from "../directory/directory.js";
import { createSupportService } from "../services/supportRequests.js";

/** A soft, in-memory per-IP cap: at most `perHour` in the last hour. */
function limiter(perHour) {
  const hits = new Map(); // ip → [times]
  return (ip) => {
    if (!ip) return false;
    const now = Date.now();
    const times = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    times.push(now);
    hits.set(ip, times);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
    return times.length > perHour;
  };
}

export function createPublicRouter() {
  const router = express.Router();
  router.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));

  const beaconLimit = limiter(240);
  router.post("/visits", async (req, res) => {
    if (beaconLimit(req.ip)) return res.status(429).end();
    const b = req.body ?? {};
    try {
      await dir.recordVisit({
        via: "client",
        path: b.path,
        referer: b.referer,
        userAgent: req.get("user-agent"),
        ip: req.ip ?? null,
        host: req.get("host"),
        region: req.get("x-client-region") || null,
        city: req.get("x-client-city") || null,
        network: dir.networkOf(req),
        client: b.client,
      });
    } catch (err) {
      req.log?.warn?.({ err: err.message }, "Visit beacon not recorded");
    }
    res.status(204).end(); // a beacon never needs an answer
  });

  const leadLimit = limiter(10);
  router.post("/leads", async (req, res, next) => {
    if (leadLimit(req.ip)) return res.status(429).json({ error: "Too many messages just now. Please try again later." });
    // Honeypot: a hidden field only a bot fills. Accept silently so it learns nothing.
    if (typeof req.body?.company === "string" && req.body.company.trim()) return res.status(201).json({ ok: true });
    try {
      const saved = await createSupportService(getDB(), { log: req.log }).submitLead(req.body);
      req.log?.info?.({ requestId: String(saved.id) }, "Lead captured from the public site");
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
