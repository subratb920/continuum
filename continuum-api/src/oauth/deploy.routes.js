// src/oauth/deploy.routes.js
//
// Read-only data for continuum-deploy, called server-to-server with the access
// token Continuum issued to it at sign-in (EdDSA, audience continuum-deploy).
// Never accepts Continuum's own session tokens, and never changes anything.
//   GET /deploy/projects   the signed-in user's projects (id, name, GitHub repo)

import { Router } from "express";
import { getDB } from "../config/db.js";
import { getOAuthConfig } from "./oauth.config.js";
import { verifyJwt } from "./oauth.crypto.js";
import { ObjectId } from "mongodb";

const router = Router();

/** Only continuum-deploy's access tokens, checked in full (signature, issuer, audience, expiry). */
function requireDeployToken(req, res, next) {
  const cfg = getOAuthConfig();
  if (!cfg) return res.status(503).json({ error: "SSO is not configured on this server." });
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = verifyJwt(token, cfg.privateKey, { issuer: cfg.issuer, audience: cfg.audience });
  if (!claims) return res.status(401).json({ error: "Invalid or expired access token." });
  if (!ObjectId.isValid(claims.sub)) return res.status(401).json({ error: "Invalid or expired access token." });
  req.deployUser = { id: new ObjectId(claims.sub), email: claims.email };
  next();
}

/** "owner/name" from the stored full name, or from the GitHub address. */
function repoOf(p) {
  if (p.fullName) return p.fullName;
  const m = /github\.com\/([^/]+\/[^/.]+)/i.exec(p.githubRepoUrl ?? "");
  return m ? m[1] : null;
}

router.get("/projects", requireDeployToken, async (req, res) => {
  const projects = await getDB()
    .collection("projects")
    .find({ userId: req.deployUser.id }, { projection: { name: 1, source: 1, fullName: 1, githubRepoUrl: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({
    items: projects.map((p) => ({
      id: String(p._id),
      name: p.name,
      source: p.source,
      repo: p.source === "github" ? repoOf(p) : null,
      githubRepoUrl: p.githubRepoUrl ?? null,
    })),
  });
});

export default router;
