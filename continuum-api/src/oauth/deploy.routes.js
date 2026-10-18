// src/oauth/deploy.routes.js
//
// Data for continuum-deploy, called server-to-server with the access token
// Continuum issued to it at sign-in (EdDSA, audience continuum-deploy). Never
// accepts Continuum's own session tokens. Read-only, except one file:
// continuum.deploy.json, written when the user edits an app's setup in Deploy.
//   GET /deploy/projects            the signed-in user's projects (id, name, GitHub repo)
//   GET /deploy/projects/:id/scan   app folders in that project's repository at the branch's
//                                   latest commit (reported as commit), and its
//                                   continuum.deploy.json and continuum.infra.json if
//                                   present (read with the user's GitHub sign-in; the
//                                   GitHub token never leaves)
//   POST /deploy/projects/:id/source  the branch's latest commit, the folders with a
//                                   Dockerfile, and a signed one-hour download address
//   GET /deploy/archives/:token     that commit's source (tar.gz), streamed from GitHub
//                                   with the user's sign-in; only with a valid address
//   PUT /deploy/projects/:id/manifest  writes continuum.deploy.json on a branch (a commit
//                                   with the user's GitHub sign-in): Deploy's "Setup" edits,
//                                   on the branch the project deploys from (main included).
//   GET /deploy/me/appearance       the user's colour theme (Deploy follows Continuum's)
//   POST /deploy/support/callbacks  "Request a callback" from Deploy's Contact us (same
//                                   requests and daily limit as Continuum's own)

import { Router } from "express";
import { getDB } from "../config/db.js";
import { accessFor } from "../access/access.js";
import { usage } from "../middleware/access.js";
import { getOAuthConfig } from "./oauth.config.js";
import { randomToken, signJwt, verifyJwt } from "./oauth.crypto.js";
import { byFolder, detectDatabases, filesToRead } from "./detect-databases.js";
import { deviceApp } from "./detect-runtime.js";
import { ObjectId } from "mongodb";
import fetch from "node-fetch";
import { getTheme } from "../services/appearance.js";
import { createSupportService } from "../services/supportRequests.js";

const router = Router();

/**
 * Only continuum-deploy's access tokens, checked in full (signature, issuer,
 * audience, expiry), for users whose role still has the deploy feature.
 */
async function requireDeployToken(req, res, next) {
  const cfg = getOAuthConfig();
  if (!cfg) return res.status(503).json({ error: "SSO is not configured on this server." });
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = verifyJwt(token, cfg.privateKey, { issuer: cfg.issuer, audience: cfg.audience });
  if (!claims) return res.status(401).json({ error: "Invalid or expired access token." });
  if (!ObjectId.isValid(claims.sub)) return res.status(401).json({ error: "Invalid or expired access token." });
  req.deployUser = { id: new ObjectId(claims.sub), email: claims.email };
  try {
    const access = await accessFor(getDB(), req.deployUser.id);
    if (!access || access.disabled) return res.status(403).json({ error: "This account is disabled. Ask your admin.", code: "ACCOUNT_DISABLED" });
    if (!access.features.includes("deploy")) return res.status(403).json({ error: "No feature access: Deploy isn't switched on for your role. Ask your admin.", code: "NO_FEATURE_ACCESS", feature: "deploy" });
    usage.used(req.deployUser.id, "deploy");
  } catch (err) {
    return next(err);
  }
  next();
}

/** "owner/name" from the stored full name, or from the GitHub address. */
function repoOf(p) {
  if (p.fullName) return p.fullName;
  const m = /github\.com\/([^/]+\/[^/.]+)/i.exec(p.githubRepoUrl ?? "");
  return m ? m[1] : null;
}

router.get("/me/appearance", requireDeployToken, async (req, res) => {
  res.json({ theme: await getTheme(getDB(), req.deployUser.id) });
});

router.post("/support/callbacks", requireDeployToken, async (req, res) => {
  const saved = await createSupportService(getDB()).requestCallback({ id: req.deployUser.id }, { ...req.body, source: "deploy" });
  req.log.info({ userId: req.deployUser.id, requestId: String(saved.id), bestTime: saved.bestTime, source: "deploy" }, "Callback requested");
  res.status(201).json({ id: saved.id, bestTime: saved.bestTime, createdAt: saved.createdAt });
});

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
// The room the project needs on Google Cloud (Continuum Deploy reads it at each deploy)
const INFRA = "continuum.infra.json";
const MAX_DEPTH = 2; // root, a/, a/b/

async function github(token, path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "continuum-api", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  const heads = {}; // branch → its latest commit (so Deploy can tell when its settings are behind)
  for (let page = 1; page <= 3; page++) {
    const r = await github(token, `/repos/${repo}/branches?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    for (const b of r.body) {
      if (typeof b.name !== "string") continue;
      names.push(b.name);
      if (typeof b.commit?.sha === "string") heads[b.name] = b.commit.sha;
    }
    if (r.body.length < 100) break;
  }
  const defaultBranch = info.body.default_branch;
  const branches = [defaultBranch, ...names.filter((n) => n !== defaultBranch).sort((a, b) => a.localeCompare(b))].filter(Boolean);
  res.json({ repo, defaultBranch, branches, heads, truncated: names.length >= 300 });
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

  // The branch's latest commit: everything below is read at that one commit (a push meanwhile can't mix two)
  const head = await github(token, `/repos/${repo}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`);
  if (head.status === 404) return res.status(404).json({ error: `Branch ${branch} wasn't found in ${repo}.` });
  if (head.status !== 200 || !head.body?.object?.sha) return res.status(502).json({ error: `GitHub couldn't show branch ${branch} of ${repo} (HTTP ${head.status}).` });
  const commit = head.body.object.sha;

  const tree = await github(token, `/repos/${repo}/git/trees/${commit}?recursive=1`);
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

  // A plain HTML site (an index.html at the root, nothing else that marks an app): the whole repository
  if (!folders.size && (tree.body.tree ?? []).some((i) => i.type === "blob" && i.path === "index.html")) folders.set("", new Set(["static"]));

  // continuum.deploy.json and continuum.infra.json at the repository root, if present
  const rootJson = async (name) => {
    if (!(tree.body.tree ?? []).some((i) => i.type === "blob" && i.path === name)) return { value: null, error: null };
    const file = await github(token, `/repos/${repo}/contents/${name}?ref=${commit}`);
    try {
      return { value: JSON.parse(Buffer.from(file.body?.content ?? "", "base64").toString("utf8")), error: null };
    } catch {
      return { value: null, error: `${name} isn't valid JSON.` };
    }
  };
  const [{ value: manifest, error: manifestError }, { value: infra, error: infraError }] = await Promise.all([rootJson(MANIFEST), rootJson(INFRA)]);

  // Which database the code uses (dependency files, compose files, .env.example names only), overall and per app folder
  let databases = [];
  let perFolder = {};
  const skipped = []; // desktop and mobile apps: built for devices, never deployed
  try {
    const texts = await Promise.all(
      filesToRead(tree.body.tree ?? [], SKIP_DIRS).map(async (path) => {
        const file = await github(token, `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`);
        return { path, text: file.status === 200 ? Buffer.from(file.body?.content ?? "", "base64").toString("utf8") : "" };
      }),
    );
    const paths = (tree.body.tree ?? []).filter((i) => i.type === "blob").map((i) => i.path);
    for (const folder of [...folders.keys()]) {
      const device = deviceApp(texts, paths, folder);
      if (device) skipped.push({ path: folder, ...device });
    }
    // A device app's folders go, with everything inside them (an Android project inside a Capacitor app)
    const left = (f) => !skipped.some((d) => f === d.path || d.path === "" || f.startsWith(`${d.path}/`));
    for (const folder of [...folders.keys()]) if (!left(folder)) folders.delete(folder);
    databases = detectDatabases(texts);
    perFolder = byFolder(texts, [...folders.keys()], (tree.body.tree ?? []).filter((i) => i.type === "blob").map((i) => i.path));
  } catch {
    databases = []; // detection is a convenience: the scan answers without it
    perFolder = {};
  }

  res.json({
    repo,
    branch,
    commit,
    defaultBranch: info.body.default_branch,
    manifest,
    manifestError,
    infra,
    infraError,
    databases,
    byFolder: perFolder,
    folders: [...folders.entries()].map(([path, kinds]) => ({ path, kinds: [...kinds].sort() })).sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
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

/**
 * Deploy's "Setup" edits: continuum.deploy.json written on the deployed
 * branch as one commit. Body: { branch, content (the whole file, JSON text),
 * message, baseCommit (the commit Deploy read the file at: refused with 409 when
 * the file changed since, so nobody's edit is lost) }. Only that file, on the
 * branch the project deploys from (main included).
 */
router.put("/projects/:id/manifest", requireDeployToken, async (req, res) => {
  const found = await projectWithGitHub(req, res, req.params.id);
  if (!found) return;
  const { repo, token } = found;
  const { branch, content, message, baseCommit } = req.body ?? {};
  if (typeof branch !== "string" || !/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) return res.status(400).json({ error: "Which branch to write to is missing." });
  if (typeof content !== "string" || content.length > 64 * 1024) return res.status(400).json({ error: `${MANIFEST} must be text of at most 64 KB.` });
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  } catch {
    return res.status(400).json({ error: `${MANIFEST} must be a JSON object.` });
  }
  const info = await github(token, `/repos/${repo}`);
  if (info.status === 401) return res.status(409).json({ error: "Continuum's GitHub access has expired. Sign in to Continuum with GitHub again." });
  if (info.status !== 200) return res.status(502).json({ error: `GitHub couldn't show ${repo} (HTTP ${info.status}).` });
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  // The file as it is on the branch now (its sha is needed to replace it), and the branch's latest commit
  const [file, head] = await Promise.all([github(token, `/repos/${repo}/contents/${MANIFEST}?ref=${ref}`), github(token, `/repos/${repo}/git/ref/heads/${ref}`)]);
  if (head.status === 404) return res.status(404).json({ error: `Branch ${branch} wasn't found in ${repo}.` });
  if (file.status !== 200 && file.status !== 404) return res.status(502).json({ error: `GitHub couldn't read ${MANIFEST} (HTTP ${file.status}).` });
  if (typeof baseCommit === "string" && head.body?.object?.sha && head.body.object.sha !== baseCommit) {
    const changed = await github(token, `/repos/${repo}/compare/${baseCommit}...${head.body.object.sha}`);
    if (changed.status !== 200 || (changed.body?.files ?? []).some((f) => f.filename === MANIFEST)) {
      return res.status(409).json({ error: `${MANIFEST} changed on ${branch} since it was read. Reload the page and make the change again.`, code: "MANIFEST_CHANGED" });
    }
  }
  const put = await github(token, `/repos/${repo}/contents/${MANIFEST}`, {
    method: "PUT",
    body: {
      message: typeof message === "string" && message.trim() ? message.trim().slice(0, 200) : `${MANIFEST}: changed in Continuum Deploy`,
      content: Buffer.from(content.endsWith("\n") ? content : `${content}\n`, "utf8").toString("base64"),
      branch,
      ...(file.status === 200 && file.body?.sha ? { sha: file.body.sha } : {}),
    },
  });
  if (put.status === 409 || put.status === 422) return res.status(409).json({ error: `${MANIFEST} changed on ${branch} meanwhile. Reload the page and make the change again.`, code: "MANIFEST_CHANGED" });
  if (put.status === 403 || put.status === 404) return res.status(403).json({ error: `Your GitHub account can't write to ${repo} (HTTP ${put.status}).` });
  if (put.status !== 200 && put.status !== 201) return res.status(502).json({ error: `GitHub didn't save ${MANIFEST} (HTTP ${put.status}).` });
  req.log.info({ userId: req.deployUser.id, repo, branch, commit: put.body?.commit?.sha }, "continuum.deploy.json written for Deploy");
  res.json({ commit: put.body?.commit?.sha ?? null, branch });
});

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
