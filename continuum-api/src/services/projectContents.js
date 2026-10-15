// src/services/projectContents.js
//
// The contents of a project imported from a device: the list of its files'
// paths and sizes, taken in the user's browser when the folder was picked.
// Never the files themselves. Shown as a tree in the project pane.

import { AppError } from "../errors/AppError.js";

export const MAX_ENTRIES = 5000;
const MAX_PATH = 500;
const MAX_FOLDER = 200;
/** Folders and files that are never part of a project's contents. */
const LEFT_OUT = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;

const invalid = (message) => new AppError(message, 400, "VALIDATION_ERROR");

/**
 * Checks and tidies the contents sent with a device import.
 * Input: { folder, entries: [[path, size], …], truncated? }
 * Output: { folder, importedAt, fileCount, totalBytes, truncated, entries }
 */
export function normalizeContents(input, now = new Date()) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw invalid("contents must be an object.");

  const folder = typeof input.folder === "string" ? input.folder.trim().slice(0, MAX_FOLDER) : "";
  if (!Array.isArray(input.entries)) throw invalid("contents.entries must be a list of [path, size].");

  const seen = new Set();
  const entries = [];
  let truncated = Boolean(input.truncated);
  for (const e of input.entries) {
    if (!Array.isArray(e) || typeof e[0] !== "string") throw invalid("Each entry is [path, size].");
    const path = e[0].replace(/\\/g, "/").replace(/^\/+/, "").trim();
    const size = Number.isFinite(e[1]) && e[1] >= 0 ? Math.floor(e[1]) : 0;
    if (!path || path.length > MAX_PATH || path.split("/").includes("..")) throw invalid(`Not a valid path: ${path.slice(0, 80)}`);
    if (LEFT_OUT.test(path) || seen.has(path)) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    seen.add(path);
    entries.push([path, size]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  return {
    folder,
    importedAt: now,
    fileCount: entries.length,
    totalBytes: entries.reduce((n, [, s]) => n + s, 0),
    truncated,
    entries,
  };
}
