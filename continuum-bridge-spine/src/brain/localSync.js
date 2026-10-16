import { useSyncExternalStore } from "react";
import { copyChanges, folderAccess, folderKey, localFoldersAvailable, savedFolder } from "./localFolder";

/**
 * Copying each worker's allowed changes into your own folder (localFolder.js),
 * and where that stands per worker, for the Agents screen:
 *   { status: "copying" | "copied" | "needs-folder" | "needs-access" | "error", files, at, error }
 */
const byAgent = new Map();
const listeners = new Set();
const set = (id, v) => {
  byAgent.set(id, v);
  listeners.forEach((fn) => fn());
};

export function useLocalCopy(agentId) {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => byAgent.get(agentId) ?? null
  );
}

/** The tools that change files: once one has run (you allowed it), your copy follows. */
export const WRITE_TOOLS = ["write", "edit", "patch", "multiedit", "apply_patch"];

/**
 * Copies the worker's changes into your folder for its project. ask: from a
 * click, so the browser may ask for access again (it forgets after a restart).
 */
export async function copyToLocal(agent, client, { ask = false } = {}) {
  if (!localFoldersAvailable() || !client.changes || !agent.repo) return;
  const id = agent._id;
  const folder = await savedFolder(folderKey(agent));
  if (!folder) return set(id, { status: "needs-folder" });
  if ((await folderAccess(folder, ask).catch(() => "denied")) !== "granted") return set(id, { status: "needs-access", folder: folder.name });
  set(id, { ...(byAgent.get(id) ?? {}), status: "copying", folder: folder.name });
  try {
    const { files } = await client.changes(id);
    const n = await copyChanges(folder, files, (path) => client.file(id, path));
    set(id, { status: "copied", files: n, changed: files.length, folder: folder.name, at: new Date().toISOString() });
  } catch (err) {
    set(id, { status: "error", folder: folder.name, error: err?.message ?? String(err) });
  }
}
