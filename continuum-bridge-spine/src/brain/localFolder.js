import { canCreateFolders, writeFiles } from "../utils/deviceFolder";

/**
 * Your own copy of a project on this computer: a folder you pick once per
 * project (the browser asks you to allow edits there). Each change you allow
 * a worker to make is written into it too: only inside that folder, and only
 * with your permission. The folder is remembered in this browser (IndexedDB;
 * browsers keep a folder's handle, never its path).
 *
 * Chrome or Edge on a computer only (canCreateFolders); elsewhere the worker's
 * changes stay on its branch.
 */
const DB = "continuum-local-folders";
const STORE = "folders";

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, run) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const localFoldersAvailable = () => canCreateFolders() && typeof indexedDB !== "undefined";

/** A worker's project: its Continuum project, or its repository. */
export const folderKey = (agent) => agent.projectId ?? agent.repo;

export async function savedFolder(key) {
  try {
    return (await tx("readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

/** Asks which folder holds your copy of the project (straight from a click). Null: cancelled. */
export async function pickFolder(key, suggestedName) {
  try {
    // The browser refuses an id longer than 32 characters
    const handle = await window.showDirectoryPicker({ id: `continuum-${String(key).replace(/[^a-z0-9_-]/gi, "-").slice(0, 22)}`, mode: "readwrite", startIn: "documents" });
    await tx("readwrite", (s) => s.put(handle, key));
    return handle;
  } catch (err) {
    if (err?.name === "AbortError") return null;
    throw new Error(`Couldn't use that folder${suggestedName ? ` for ${suggestedName}` : ""}: ${err?.message ?? err}`);
  }
}

export async function forgetFolder(key) {
  await tx("readwrite", (s) => s.delete(key));
}

/** "granted", or "prompt" (the browser asks again after a restart: only from a click, ask=true). */
export async function folderAccess(handle, ask = false) {
  const opts = { mode: "readwrite" };
  const now = await handle.queryPermission(opts);
  if (now === "granted" || !ask) return now;
  return handle.requestPermission(opts);
}

/** Only paths inside the folder: no "..", no absolute paths. */
const SAFE = (p) => typeof p === "string" && p && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === ".." || s === "." || s === "");

function bytesOf(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function removeFile(folder, path) {
  const parts = path.split("/");
  let dir = folder;
  for (const p of parts.slice(0, -1)) {
    try {
      dir = await dir.getDirectoryHandle(p);
    } catch {
      return; // not there: nothing to remove
    }
  }
  await dir.removeEntry(parts.at(-1)).catch(() => {});
}

/**
 * Makes your folder match the worker's changes: changed and new files
 * written, removed ones removed. readFile(path) → { type, content }.
 * Returns how many files were written or removed.
 */
export async function copyChanges(folder, files, readFile) {
  let done = 0;
  for (const f of files) {
    if (!SAFE(f.file)) continue;
    if (f.status === "deleted") {
      await removeFile(folder, f.file);
      done++;
      continue;
    }
    const c = await readFile(f.file);
    await writeFiles(folder, [{ path: f.file, data: c.type === "binary" ? bytesOf(c.content) : c.content }]);
    done++;
  }
  return done;
}
