import { AppError } from "../errors/AppError.js";

/**
 * A device project's GitHub address, as read from its git remote by the UI.
 * Only a plain https://github.com/<owner>/<repo> is kept: no credentials,
 * no other hosts, no paths beyond the repository.
 */
const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

/** The address, or null when none was given; anything else is refused. */
export function normalizeGithubRepoUrl(value) {
  if (value === undefined || value === null || value === "") return null;
  const m = typeof value === "string" ? REPO_URL.exec(value.trim()) : null;
  if (!m || m[2] === "." || m[2] === ".." || m[2].endsWith(".git")) {
    throw new AppError("githubRepoUrl must look like https://github.com/<owner>/<repo>.", 400, "VALIDATION_ERROR");
  }
  return `https://github.com/${m[1]}/${m[2]}`;
}
