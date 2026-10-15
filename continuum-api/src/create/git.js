// src/create/git.js
//
// "Initialise a git repository": the generated project gets a .git folder
// with branch main and one first commit, made with isomorphic-git (pure JS)
// in a temporary folder that is always removed. With a GitHub repository the
// same commit is pushed, so both histories match. The token is only passed
// to the push; it is never written into .git/config or anywhere else.

import fs from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";

export const FIRST_COMMIT_MESSAGE = "Initial commit from Continuum";

async function listFiles(root, dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(root, full, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

/**
 * files: [[path, contents, executable?]] → the same files plus .git/…,
 * committed on main. remoteUrl (optional): origin, e.g. https://github.com/o/r.git
 * push (optional): { token } pushes main to origin.
 */
export async function withGitRepository(files, { author, remoteUrl = null, push = null }) {
  const dir = await mkdtemp(join(tmpdir(), "continuum-create-"));
  try {
    for (const [path, contents] of files) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents);
    }
    await git.init({ fs, dir, defaultBranch: "main" });
    for (const [path] of files) await git.add({ fs, dir, filepath: path });
    const sha = await git.commit({ fs, dir, message: FIRST_COMMIT_MESSAGE, author });
    if (remoteUrl) {
      await git.addRemote({ fs, dir, remote: "origin", url: remoteUrl });
    }
    if (push) {
      const result = await git.push({
        fs,
        http,
        dir,
        remote: "origin",
        ref: "main",
        onAuth: () => ({ username: "x-access-token", password: push.token }),
      });
      const main = result?.refs?.["refs/heads/main"];
      if (!result?.ok || (main && !main.ok)) throw new Error(main?.error || result?.error || "the server refused the push");
      // Track origin/main like a clone would
      await git.setConfig({ fs, dir, path: "branch.main.remote", value: "origin" });
      await git.setConfig({ fs, dir, path: "branch.main.merge", value: "refs/heads/main" });
    }
    const gitFiles = [];
    for (const path of await listFiles(dir, join(dir, ".git"))) {
      const full = join(dir, path);
      if ((await stat(full)).isFile()) gitFiles.push([path, await readFile(full)]);
    }
    return { files: [...files, ...gitFiles], sha };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
