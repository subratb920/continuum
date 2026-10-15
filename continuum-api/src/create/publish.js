// src/create/publish.js
//
// "Put on GitHub": a project without a GitHub repository gets one, so it can
// have a workspace (a workspace always works on the project's repository).
//   POST /projects/:id/github?name=<repo>&private=1   body: the folder as .tar.gz (optional)
// The files (dependencies, git, build output and .env files left out) become
// the first commit, pushed to a new repository on the user's GitHub; with no
// files the repository starts with a README. Nothing is kept here: the
// temporary folder is removed, and the project only gains its GitHub link.

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { checkRepoName, createRepo, githubAccount, githubTokenOf, repoAvailable } from "./github.js";
import { withGitRepository } from "./git.js";
import { readTarGz } from "./tar.js";
import { CREATIONS_COLLECTION, HOURLY_LIMIT } from "./routes.js";
import { repoOf } from "../workspaces/routes.js";

/** Never pushed: dependencies, git, build output, secrets (as the device import leaves them out). */
export const LEFT_OUT = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;
export const MAX_FILES = 5000;
export const MAX_BYTES = 50 * 1024 * 1024;

/** The files worth pushing from an uploaded folder (checked again here, whatever the browser sent). */
export function filesToPush(entries) {
  const files = entries.filter((f) => f.path && !LEFT_OUT.test(f.path) && !f.path.startsWith("/") && !f.path.split("/").includes(".."));
  if (files.length > MAX_FILES) throw new AppError(`That folder has more than ${MAX_FILES} files (without dependencies and build output). Push it to GitHub yourself, then import it.`, 413, "TOO_LARGE");
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > MAX_BYTES) throw new AppError("That folder is larger than 50 MB (without dependencies and build output). Push it to GitHub yourself, then import it.", 413, "TOO_LARGE");
  return files;
}

const router = express.Router();

router.post("/:id/github", express.raw({ type: "application/gzip", limit: "60mb" }), async (req, res) => {
  const db = getDB();
  const userId = new ObjectId(req.user.id);
  if (!ObjectId.isValid(req.params.id)) throw new AppError("Not a project.", 404, "NOT_FOUND");
  const project = await db.collection(PROJECT_COLLECTION).findOne({ _id: new ObjectId(req.params.id), userId });
  if (!project) throw new AppError("Not a project.", 404, "NOT_FOUND");
  if (repoOf(project)) throw new AppError("This project is already on GitHub.", 409, "ALREADY_ON_GITHUB");

  const since = new Date(Date.now() - 3600_000);
  if ((await db.collection(CREATIONS_COLLECTION).countDocuments({ userId, createdAt: { $gte: since } })) >= HOURLY_LIMIT) {
    throw new AppError("You've created many repositories in the last hour; please try again a little later.", 429, "TOO_MANY_REQUESTS");
  }

  const token = await githubTokenOf(db, req.user.id);
  if (!token) throw new AppError("Sign in with GitHub to put projects on GitHub.", 400, "GITHUB_NOT_CONNECTED");
  const name = checkRepoName(String(req.query.name ?? project.name));
  const isPrivate = req.query.private !== "0";
  const account = await githubAccount(token);
  if (!(await repoAvailable(token, account.login, name))) {
    throw Object.assign(new AppError(`A repository called “${name}” already exists on your GitHub.`, 409, "REPO_EXISTS"), { field: "name" });
  }

  // The uploaded folder, or a README to start from
  let files = [];
  if (Buffer.isBuffer(req.body) && req.body.length) {
    let entries;
    try {
      entries = readTarGz(req.body, MAX_BYTES * 2);
    } catch {
      throw new AppError("The folder couldn't be read (or is too large).", 400, "VALIDATION_ERROR");
    }
    files = filesToPush(entries).map((f) => [f.path, f.data, f.executable]);
  }
  if (!files.length) files = [["README.md", `# ${project.name}\n\nCreated with Continuum.\n`]];

  const user = await db.collection("users").findOne({ _id: userId }, { projection: { email: 1, name: 1 } });
  const email = user?.email ?? "user@continuum.local";
  const author = { name: account.name ?? user?.name ?? email.split("@")[0], email };
  const repo = await createRepo(token, { name, description: `${project.name} (from Continuum)`, isPrivate });
  try {
    await withGitRepository(files, { author, remoteUrl: repo.cloneUrl, push: { token } });
  } catch (e) {
    req.log.warn({ userId: req.user.id, repo: repo.fullName, err: e.message }, "Push to the new GitHub repository failed");
    throw new AppError(`The repository ${repo.fullName} was created, but the push failed (${e.message}). Delete the empty repository on GitHub and try again.`, 502, "PUSH_FAILED");
  }

  const set = { githubRepoUrl: repo.htmlUrl, fullName: repo.fullName, githubRepoId: repo.id, visibility: repo.isPrivate ? "private" : "public", updatedAt: new Date() };
  await db.collection(PROJECT_COLLECTION).updateOne({ _id: project._id }, { $set: set });
  await db.collection(CREATIONS_COLLECTION).insertOne({ userId, kind: "publish", projectId: project._id, github: { repo: repo.fullName, private: repo.isPrivate }, files: files.length, createdAt: new Date() });
  req.log.info({ userId: req.user.id, repo: repo.fullName, files: files.length }, "Project put on GitHub");
  res.status(201).json({ project: { _id: String(project._id), name: project.name, ...set } });
});

export default router;
