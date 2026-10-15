// src/create/github.js
//
// "Create a repository on GitHub" for the New Project wizard, with the token
// the user's GitHub sign-in stored (scope: repo). The token is only sent to
// GitHub (these calls and git's push); it is never written to the project,
// logged or returned.

import { ObjectId } from "mongodb";
import { AppError } from "../errors/AppError.js";

const API = "https://api.github.com";

/** GitHub's repository-name rule (letters, digits, - . _; not "." or "..") */
export const REPO_NAME = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

export function checkRepoName(name) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!REPO_NAME.test(n) || n.endsWith(".git")) {
    throw Object.assign(new AppError("Repository name: letters, digits, '-', '.', '_' (up to 100).", 400, "VALIDATION_ERROR"), { field: "git.github.name" });
  }
  return n;
}

async function gh(token, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

/** The signed-in user's GitHub token, or null (signed in with email, or GitHub not connected) */
export async function githubTokenOf(db, userId) {
  const user = await db.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { githubAccessToken: 1 } });
  return user?.githubAccessToken || null;
}

/** { login, name } of the token's account; throws when GitHub refuses the token */
export async function githubAccount(token, opts) {
  const { status, data } = await gh(token, "/user", opts);
  if (status === 401) throw new AppError("GitHub sign-in has expired; sign in with GitHub again to create repositories.", 401, "GITHUB_REAUTH");
  if (status !== 200 || !data?.login) throw new AppError("GitHub couldn't be reached; please try again.", 502, "UPSTREAM_UNAVAILABLE");
  return { login: data.login, name: data.name || data.login };
}

/** Is owner/name free? */
export async function repoAvailable(token, owner, name, opts) {
  const { status } = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, opts);
  if (status === 404) return true;
  if (status === 200) return false;
  throw new AppError("GitHub couldn't be reached; please try again.", 502, "UPSTREAM_UNAVAILABLE");
}

/** Creates an empty repository (no README, so the first commit pushes cleanly) */
export async function createRepo(token, { name, description = "", isPrivate = true }, opts) {
  const { status, data } = await gh(token, "/user/repos", {
    ...opts,
    method: "POST",
    body: { name, description: description.slice(0, 350), private: isPrivate, auto_init: false },
  });
  if (status === 201) return { htmlUrl: data.html_url, cloneUrl: data.clone_url, fullName: data.full_name };
  if (status === 422) throw Object.assign(new AppError(`A repository called “${name}” already exists on your GitHub.`, 409, "REPO_EXISTS"), { field: "git.github.name" });
  if (status === 401 || status === 403) throw new AppError("GitHub didn't allow creating the repository; sign in with GitHub again.", 403, "GITHUB_FORBIDDEN");
  throw new AppError(`GitHub couldn't create the repository (${status}).`, 502, "UPSTREAM_UNAVAILABLE");
}
