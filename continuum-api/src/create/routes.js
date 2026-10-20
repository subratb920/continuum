// src/create/routes.js
//
// The New Project wizard's API (signed-in users):
//   GET  /create/catalog   what can be created (drawn by the wizard)
//   POST /create/preview   the files a set of choices would produce
//   POST /create/generate  the project as .tar.gz (with .git when asked, and
//                          pushed to a new GitHub repository when asked);
//                          the browser writes it into the chosen folder.
//                          With target "github" (phones: no folders there) it
//                          only goes to the new repository, nothing is sent
//                          back or kept here, and the project is added to the
//                          user's projects as a GitHub project
//   GET  /create/github    whether a GitHub repository can be created (and as whom)
//   GET  /create/github/available?name=  is that repository name free?

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { catalogJson, refreshCatalog } from "./catalog/index.js";
import { generateProject } from "./generate.js";
import { withGitRepository } from "./git.js";
import { tarGz } from "./tar.js";
import { checkRepoName, createRepo, githubAccount, githubTokenOf, repoAvailable } from "./github.js";
import { createProjectService } from "../services/project.service.js";

const router = express.Router();

/**
 * Where a generated project goes: "archive" (default; the browser writes it
 * into a folder) or "github" (only to a new repository, which must be asked for).
 */
export function targetOf(body) {
  const target = body?.target ?? "archive";
  if (target !== "archive" && target !== "github") throw Object.assign(new AppError("target must be archive or github.", 400, "VALIDATION_ERROR"), { field: "target" });
  if (target === "github" && body?.git?.github?.create !== true) {
    throw Object.assign(new AppError("Without a folder on this device, the project goes to a new GitHub repository: choose its name.", 400, "VALIDATION_ERROR"), { field: "git.github.create" });
  }
  if (target === "github" && body?.git?.init === false) {
    throw Object.assign(new AppError("A GitHub repository needs a git repository; tick “Initialise a git repository”.", 400, "VALIDATION_ERROR"), { field: "git.init" });
  }
  return target;
}

export const CREATIONS_COLLECTION = "project_creations";
/** At most this many projects created per person per hour. */
export const HOURLY_LIMIT = 30;
/** A generated project (without dependencies) is small; anything bigger is a template fault. */
const MAX_BYTES = 20 * 1024 * 1024;

// Spring Boot's part of the catalogue comes live from start.spring.io (cached hourly)
router.use(async (_req, _res, next) => {
  await refreshCatalog();
  next();
});

router.get("/catalog", (_req, res) => {
  res.set("Cache-Control", "private, max-age=300");
  res.json(catalogJson());
});

router.get("/github", async (req, res) => {
  const token = await githubTokenOf(getDB(), req.user.id);
  if (!token) return res.json({ connected: false, reason: "Sign in with GitHub to create repositories." });
  try {
    const { login } = await githubAccount(token);
    res.json({ connected: true, login });
  } catch (e) {
    res.json({ connected: false, reason: e.message });
  }
});

router.get("/github/available", async (req, res) => {
  const name = checkRepoName(req.query.name);
  const token = await githubTokenOf(getDB(), req.user.id);
  if (!token) throw new AppError("Sign in with GitHub to create repositories.", 400, "GITHUB_NOT_CONNECTED");
  const { login } = await githubAccount(token);
  res.json({ name, owner: login, available: await repoAvailable(token, login, name) });
});

router.post("/preview", async (req, res) => {
  const { name, files } = await generateProject(req.body, { resolve: false });
  res.json({ name, files: files.map(([path, contents]) => [path, Buffer.byteLength(contents)]) });
});

router.post("/generate", async (req, res) => {
  const db = getDB();
  const userId = new ObjectId(req.user.id);
  const since = new Date(Date.now() - 3600_000);
  const recent = await db.collection(CREATIONS_COLLECTION).countDocuments({ userId, createdAt: { $gte: since } });
  if (recent >= HOURLY_LIMIT) {
    throw new AppError("You've created many projects in the last hour; please try again a little later.", 429, "TOO_MANY_REQUESTS");
  }

  const git = req.body?.git ?? {};
  const wantsGithub = git.github?.create === true;
  const target = targetOf(req.body);
  if (wantsGithub && git.init === false) {
    throw Object.assign(new AppError("A GitHub repository needs a git repository; tick “Initialise a git repository”.", 400, "VALIDATION_ERROR"), { field: "git.init" });
  }

  // GitHub first checks only (nothing is created until the project has been generated)
  let github = null;
  if (wantsGithub) {
    const name = checkRepoName(git.github.name);
    const token = await githubTokenOf(db, userId);
    if (!token) throw new AppError("Sign in with GitHub to create repositories.", 400, "GITHUB_NOT_CONNECTED");
    const account = await githubAccount(token);
    if (!(await repoAvailable(token, account.login, name))) {
      throw Object.assign(new AppError(`A repository called “${name}” already exists on your GitHub.`, 409, "REPO_EXISTS"), { field: "git.github.name" });
    }
    github = { token, account, name, isPrivate: git.github.private !== false };
  }

  const project = await generateProject(req.body, { resolve: true });
  let files = project.files;
  let sha = null;
  let repo = null;

  if (git.init !== false) {
    const user = await db.collection("users").findOne({ _id: userId }, { projection: { email: 1, name: 1 } });
    const email = user?.email ?? "user@continuum.local";
    const author = { name: github?.account.name ?? user?.name ?? email.split("@")[0], email };
    if (github) {
      repo = await createRepo(github.token, { name: github.name, description: req.body?.details?.description ?? "", isPrivate: github.isPrivate });
      try {
        ({ files, sha } = await withGitRepository(files, { author, remoteUrl: repo.cloneUrl, push: { token: github.token } }));
      } catch (e) {
        req.log.warn({ userId, repo: repo.fullName, err: e.message }, "Push to the new GitHub repository failed");
        throw new AppError(`The repository ${repo.fullName} was created, but the first push failed (${e.message}). Push the project yourself, or delete the empty repository on GitHub and try again.`, 502, "PUSH_FAILED");
      }
    } else {
      ({ files, sha } = await withGitRepository(files, { author }));
    }
  }

  const archive = target === "archive" ? tarGz(files, project.name.replace(/^@[^/]+\//, "")) : null;
  if (archive && archive.length > MAX_BYTES) throw new AppError("The generated project is unexpectedly large.", 500, "TEMPLATE_ERROR");

  await db.collection(CREATIONS_COLLECTION).insertOne({
    userId,
    kind: project.kind,
    variant: project.variant,
    dependencies: Array.isArray(req.body?.dependencies) ? req.body.dependencies.slice(0, 60) : [],
    git: Boolean(sha),
    github: repo ? { repo: repo.fullName, private: github.isPrivate } : null,
    createdAt: new Date(),
  });
  req.log.info({ userId, kind: project.kind, variant: project.variant, files: files.length, git: Boolean(sha), github: repo?.fullName ?? null, target }, "Project generated");

  if (target === "github") {
    // The repository is the project's home: added like an import from GitHub
    const projects = await createProjectService(db);
    const id = await projects.createProjectFromGithub(req.user.id, { id: repo.id, name: repo.name, html_url: repo.htmlUrl, private: repo.isPrivate, full_name: repo.fullName }, req.space, { departmentIds: req.body?.departmentIds });
    res.status(201).json({ project: { _id: String(id), name: repo.name, source: "github", githubRepoId: repo.id, githubRepoUrl: repo.htmlUrl, visibility: repo.isPrivate ? "private" : "public", fullName: repo.fullName }, commit: sha });
    return;
  }

  res.set({
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${project.name.replace(/^@[^/]+\//, "")}.tar.gz"`,
    "X-Project-Name": project.name,
    ...(sha && { "X-Commit": sha }),
    ...(repo && { "X-GitHub-Repo": repo.htmlUrl }),
    "Access-Control-Expose-Headers": "X-Project-Name, X-Commit, X-GitHub-Repo",
  });
  res.send(archive);
});

export default router;
