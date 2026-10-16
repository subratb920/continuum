// src/create/clone.js
//
// "Download from GitHub" (a project's GitHub icon): its repository as a git
// clone (latest commit of the default branch, origin = GitHub, the sign-in
// never written into it), sent as a .tar.gz the browser writes into the folder
// the user picks on their computer. Nothing about where it goes is kept here.
//   GET /projects/:id/clone

import express from "express";
import { ObjectId } from "mongodb";
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { githubTokenOf } from "./github.js";
import { tarGz } from "./tar.js";
import { repoOf } from "../workspaces/routes.js";

/** A clone bigger than this (unpacked) is refused: clone large repositories with git yourself. */
const MAX_CLONE_BYTES = 200 * 1024 * 1024;

const router = express.Router();

async function listFiles(root, dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(root, full, out);
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

/**
 * A git clone of the project's repository (latest commit of its default branch,
 * origin = GitHub, the sign-in never written into it), as a .tar.gz the browser
 * writes into the folder it chose. The temporary folder is always removed.
 */
router.get("/:id/clone", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) throw new AppError("Not a project.", 404, "NOT_FOUND");
  const p = await getDB().collection(PROJECT_COLLECTION).findOne({ _id: new ObjectId(req.params.id), userId: new ObjectId(req.user.id) });
  if (!p) throw new AppError("Not a project.", 404, "NOT_FOUND");
  const repo = repoOf(p);
  if (!repo) throw new AppError("This project has no GitHub repository to get.", 400, "NO_REPOSITORY");
  const token = await githubTokenOf(getDB(), req.user.id);
  if (!token) throw new AppError("Sign in with GitHub to get this project's files.", 400, "GITHUB_NOT_CONNECTED");
  const dir = await mkdtemp(join(tmpdir(), "continuum-clone-"));
  try {
    const url = `https://github.com/${repo}.git`;
    try {
      await git.clone({ fs, http, dir, url, depth: 1, singleBranch: true, onAuth: () => ({ username: "x-access-token", password: token }) });
    } catch (e) {
      throw new AppError(`GitHub couldn't give ${repo} (${e.message}).`, 502, "UPSTREAM_UNAVAILABLE");
    }
    // origin stays the plain GitHub address (no sign-in in it)
    await git.setConfig({ fs, dir, path: "remote.origin.url", value: url });
    const files = [];
    let total = 0;
    for (const path of await listFiles(dir)) {
      const full = join(dir, path);
      const info = await stat(full);
      total += info.size;
      if (total > MAX_CLONE_BYTES) throw new AppError(`${repo} is larger than 200 MB: clone it with git yourself.`, 413, "TOO_LARGE");
      files.push([path, await readFile(full), Boolean(info.mode & 0o111)]);
    }
    const archive = tarGz(files, repo.split("/")[1]);
    req.log.info({ userId: req.user.id, repo, files: files.length }, "Project cloned for a device");
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${repo.split("/")[1]}.tar.gz"` });
    res.send(archive);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

export default router;
