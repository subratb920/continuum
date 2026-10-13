// src/oauth/deploy.routes.js
//
// Read-only data for continuum-deploy, called server-to-server with the access
// token Continuum issued to it at sign-in (EdDSA, audience continuum-deploy).
// Never accepts Continuum's own session tokens, and never changes anything.
//   GET /deploy/projects            the signed-in user's projects (id, name, GitHub repo)
//   GET /deploy/projects/:id/scan   app folders in that project's repository, and its
//                                   continuum.deploy.json if present (read with the
//                                   user's GitHub sign-in; the GitHub token never leaves)
//   POST /deploy/projects/:id/source  the branch's latest commit, the folders with a
//                                   Dockerfile, and a signed one-hour download address
//   GET /deploy/archives/:token     that commit's source (tar.gz), streamed from GitHub
//                                   with the user's sign-in; only with a valid address

import { Router } from "express";
import { getDB } from "../config/db.js";
import { getOAuthConfig } from "./oauth.config.js";
import { randomToken, signJwt, verifyJwt } from "./oauth.crypto.js";
import { byFolder, detectDatabases, filesToRead } from "./detect-databases.js";
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

/** The repository's branches (read-only, up to 300), default first, so the deploy page can offer a choice. */
router.get("/projects/:id/branches", requireDeployToken, async (req, res) => {
  const found = await projectWithGitHub(req, res, req.params.id);
  if (!found) return;
  const { repo, token } = found;
  const info = await github(token, `/repos/${repo}`);
  if (info.status === 401) return res.status(409).json({ error: "Continuum's GitHub access has expired. Sign in to Continuum with GitHub again." });
  if (info.status !== 200) return res.status(502).json({ error: `GitHub couldn't show ${repo} (HTTP ${info.status}).` });
  const names = [];
  for (let page = 1; page <= 3; page++) {
    const r = await github(token, `/repos/${repo}/branches?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    names.push(...r.body.map((b) => b.name).filter((n) => typeof n === "string"));
    if (r.body.length < 100) break;
  }
  const defaultBranch = info.body.default_branch;
  const branches = [defaultBranch, ...names.filter((n) => n !== defaultBranch).sort((a, b) => a.localeCompare(b))].filter(Boolean);
  res.json({ repo, defaultBranch, branches, truncated: names.length >= 300 });
});

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

  // Which database the code uses (dependency files, compose files, .env.example names only), overall and per app folder
  let databases = [];
  let perFolder = {};
  try {
    const texts = await Promise.all(
      filesToRead(tree.body.tree ?? [], SKIP_DIRS).map(async (path) => {
        const file = await github(token, `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
        return { path, text: file.status === 200 ? Buffer.from(file.body?.content ?? "", "base64").toString("utf8") : "" };
      }),
    );
    databases = detectDatabases(texts);
    perFolder = byFolder(texts, [...folders.keys()]);
  } catch {
    databases = []; // detection is a convenience: the scan answers without it
    perFolder = {};
  }

  res.json({
    repo,
    branch,
    defaultBranch: info.body.default_branch,
    manifest,
    manifestError,
    databases,
    byFolder: perFolder,
    folders: [...folders.entries()].map(([path, kinds]) => ({ path, kinds: [...kinds].sort() })).sort((a, b) => a.path.localeCompare(b.path)),
    truncated: Boolean(tree.body.truncated),
  });
});

/** A download address for one commit's source is good for an hour, and only for that commit. */
const ARCHIVE_AUDIENCE = "continuum-deploy-archive";
const ARCHIVE_TTL_SECONDS = 60 * 60;
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

/** The user's project with its repository and their GitHub token, or an error answer already sent. */
async function projectWithGitHub(req, res, projectId) {
  if (!ObjectId.isValid(projectId)) return void res.status(404).json({ error: "Project not found." });
  const db = getDB();
  const project = await db.collection("projects").findOne({ _id: new ObjectId(projectId), userId: req.deployUser.id });
  if (!project) return void res.status(404).json({ error: "Project not found." });
  const repo = repoOf(project);
  if (project.source !== "github" || !repo) return void res.status(400).json({ error: "This project isn't linked to GitHub." });
  const user = await db.collection("users").findOne({ _id: req.deployUser.id }, { projection: { githubAccessToken: 1 } });
  if (!user?.githubAccessToken) return void res.status(409).json({ error: "Sign in to Continuum with GitHub so Continuum can read this repository." });
  return { project, repo, token: user.githubAccessToken };
}

router.post("/projects/:id/source", requireDeployToken, async (req, res) => {
  const found = await projectWithGitHub(req, res, req.params.id);
  if (!found) return;
  const { repo, token } = found;
  const asked = typeof req.body?.branch === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(req.body.branch) ? req.body.branch : null;
  let branch = asked;
  if (!branch) {
    const info = await github(token, `/repos/${repo}`);
    if (info.status === 401) return res.status(409).json({ error: "Continuum's GitHub access has expired. Sign in to Continuum with GitHub again." });
    if (info.status !== 200) return res.status(502).json({ error: `GitHub couldn't show ${repo} (HTTP ${info.status}).` });
    branch = info.body.default_branch;
  }
  const commit = await github(token, `/repos/${repo}/commits/${encodeURIComponent(branch)}`);
  if (commit.status === 401) return res.status(409).json({ error: "Continuum's GitHub access has expired. Sign in to Continuum with GitHub again." });
  if (commit.status === 404 || commit.status === 422) return res.status(404).json({ error: `Branch ${branch} wasn't found in ${repo}.` });
  if (commit.status !== 200) return res.status(502).json({ error: `GitHub couldn't read ${repo} (HTTP ${commit.status}).` });
  const sha = commit.body.sha;

  const tree = await github(token, `/repos/${repo}/git/trees/${sha}?recursive=1`);
  const dockerfiles = (tree.body?.tree ?? [])
    .filter((i) => i.type === "blob" && /(^|\/)Dockerfile$/.test(i.path) && !i.path.split("/").some((p) => SKIP_DIRS.has(p)))
    .map((i) => i.path.replace(/\/?Dockerfile$/, ""));

  const cfg = getOAuthConfig();
  const now = Math.floor(Date.now() / 1000);
  const archiveToken = signJwt(
    { iss: cfg.issuer, aud: ARCHIVE_AUDIENCE, sub: String(req.deployUser.id), prj: req.params.id, repo, sha, iat: now, exp: now + ARCHIVE_TTL_SECONDS, jti: randomToken(12) },
    cfg.privateKey,
    cfg.keyId,
  );
  res.json({ repo, branch, commitSha: sha, dockerfiles, archivePath: `/deploy/archives/${archiveToken}`, expiresAt: new Date((now + ARCHIVE_TTL_SECONDS) * 1000).toISOString() });
});

// No deploy access token here: the signed address itself is the permission (it names one commit)
router.get("/archives/:token", async (req, res) => {
  const cfg = getOAuthConfig();
  if (!cfg) return res.status(503).json({ error: "SSO is not configured on this server." });
  const claims = verifyJwt(req.params.token, cfg.privateKey, { issuer: cfg.issuer, audience: ARCHIVE_AUDIENCE });
  if (!claims || !ObjectId.isValid(claims.sub) || typeof claims.repo !== "string" || !/^[0-9a-f]{40}$/.test(String(claims.sha))) {
    return res.status(401).json({ error: "This download address is invalid or has expired." });
  }
  req.deployUser = { id: new ObjectId(claims.sub) };
  const found = await projectWithGitHub(req, res, claims.prj);
  if (!found) return;
  if (found.repo !== claims.repo) return res.status(409).json({ error: "The project's repository changed since this address was made." });

  const gh = await fetch(`https://api.github.com/repos/${found.repo}/tarball/${claims.sha}`, {
    headers: { Authorization: `Bearer ${found.token}`, Accept: "application/vnd.github+json", "User-Agent": "continuum-api" },
    redirect: "follow",
  });
  if (gh.status !== 200) return res.status(502).json({ error: `GitHub couldn't send the source (HTTP ${gh.status}).` });
  const size = Number(gh.headers.get("content-length") ?? 0);
  if (size > MAX_ARCHIVE_BYTES) return res.status(413).json({ error: "The repository is larger than 500 MB." });
  res.set({ "Content-Type": "application/gzip", "Cache-Control": "no-store", ...(size ? { "Content-Length": String(size) } : {}) });
  let sent = 0;
  gh.body.on("data", (chunk) => {
    sent += chunk.length;
    if (sent > MAX_ARCHIVE_BYTES) gh.body.destroy(new Error("too large"));
  });
  gh.body.on("error", () => res.destroy());
  gh.body.pipe(res);
});

export default router;
