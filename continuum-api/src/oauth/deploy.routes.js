// src/oauth/deploy.routes.js
//
// Read-only data for continuum-deploy, called server-to-server with the access
// token Continuum issued to it at sign-in (EdDSA, audience continuum-deploy).
// Never accepts Continuum's own session tokens, and never changes anything.
//   GET /deploy/projects            the signed-in user's projects (id, name, GitHub repo)
//   GET /deploy/projects/:id/scan   app folders in that project's repository, and its
//                                   continuum.deploy.json if present (read with the
//                                   user's GitHub sign-in; the GitHub token never leaves)

import { Router } from "express";
import { getDB } from "../config/db.js";
import { getOAuthConfig } from "./oauth.config.js";
import { verifyJwt } from "./oauth.crypto.js";
import { ObjectId } from "mongodb";
import fetch from "node-fetch";

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

/** Files that mark a folder as a buildable app. */
const APP_MARKERS = {
  "package.json": "node",
  Dockerfile: "docker",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "go.mod": "go",
  Gemfile: "ruby",
  "Cargo.toml": "rust",
  "pom.xml": "java",
  "build.gradle": "java",
  "composer.json": "php",
};
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "vendor", ".git", ".github", "coverage", "out", ".next"]);
const MANIFEST = "continuum.deploy.json";
const MAX_DEPTH = 2; // root, a/, a/b/

async function github(token, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "continuum-api" },
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

router.get("/projects/:id/scan", requireDeployToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Project not found." });
  const db = getDB();
  const project = await db.collection("projects").findOne({ _id: new ObjectId(req.params.id), userId: req.deployUser.id });
  if (!project) return res.status(404).json({ error: "Project not found." });
  const repo = repoOf(project);
  if (project.source !== "github" || !repo) return res.status(400).json({ error: "This project isn't linked to GitHub." });

  const user = await db.collection("users").findOne({ _id: req.deployUser.id }, { projection: { githubAccessToken: 1 } });
  const token = user?.githubAccessToken;
  if (!token) return res.status(409).json({ error: "Sign in to Continuum with GitHub so Continuum can read this repository." });

  const info = await github(token, `/repos/${repo}`);
  if (info.status === 401) return res.status(409).json({ error: "Continuum's GitHub access has expired. Sign in to Continuum with GitHub again." });
  if (info.status !== 200) return res.status(502).json({ error: `GitHub couldn't show ${repo} (HTTP ${info.status}).` });
  const branch = typeof req.query.branch === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(req.query.branch) ? req.query.branch : info.body.default_branch;

  const tree = await github(token, `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (tree.status === 404) return res.status(404).json({ error: `Branch ${branch} wasn't found in ${repo}.` });
  if (tree.status !== 200) return res.status(502).json({ error: `GitHub couldn't list ${repo} (HTTP ${tree.status}).` });

  const folders = new Map();
  for (const item of tree.body.tree ?? []) {
    if (item.type !== "blob") continue;
    const parts = item.path.split("/");
    const file = parts.pop();
    if (parts.length > MAX_DEPTH || parts.some((p) => SKIP_DIRS.has(p))) continue;
    const kind = APP_MARKERS[file];
    if (!kind) continue;
    const folder = parts.join("/");
    if (!folders.has(folder)) folders.set(folder, new Set());
    folders.get(folder).add(kind);
  }

  // continuum.deploy.json at the repository root, if present
  let manifest = null;
  let manifestError = null;
  if ((tree.body.tree ?? []).some((i) => i.type === "blob" && i.path === MANIFEST)) {
    const file = await github(token, `/repos/${repo}/contents/${MANIFEST}?ref=${encodeURIComponent(branch)}`);
    try {
      manifest = JSON.parse(Buffer.from(file.body?.content ?? "", "base64").toString("utf8"));
    } catch {
      manifestError = `${MANIFEST} isn't valid JSON.`;
    }
  }

  res.json({
    repo,
    branch,
    defaultBranch: info.body.default_branch,
    manifest,
    manifestError,
    folders: [...folders.entries()].map(([path, kinds]) => ({ path, kinds: [...kinds].sort() })).sort((a, b) => a.path.localeCompare(b.path)),
    truncated: Boolean(tree.body.truncated),
  });
});

export default router;
