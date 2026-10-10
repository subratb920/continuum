import { patchBridge, patchBridgeKeepalive } from "../api";

/**
 * Bridge autosave
 * ---------------
 * - Latest change wins: one save at a time per bridge; changes made
 *   while a save is in flight are merged (newer fields win) and sent
 *   next. An older save can't overwrite a newer one.
 * - Each change is sent with the login token that was active when it
 *   was made (held in memory only), so signing out in another tab
 *   can't make it fail.
 * - Saved even when leaving: each change is kept in localStorage until
 *   the server confirms it. On page hide it is sent with keepalive, and
 *   on the next load the resumed draft re-sends it (including a
 *   pending "end interval").
 * - No retries: a failed save stays in localStorage for the next load.
 *
 * queueBridgeSave resolves to { ok, unauthorized } for the newest save.
 */

const TOKEN_KEY = "continuum_token";

const pending = new Map(); // bridgeId -> { data, token } not yet sent
const running = new Map(); // bridgeId -> Promise<{ ok, unauthorized }>
const unsaved = new Map(); // bridgeId -> { data, token } not yet confirmed

const storageKey = (id) => `continuum_bridge_unsaved_${id}`;

function remember(id, entry) {
  unsaved.set(id, entry);
  try {
    // Data only — the token is never written to storage
    localStorage.setItem(storageKey(id), JSON.stringify(entry.data));
  } catch {
    // storage unavailable — in-memory copy still used
  }
}

function forget(id) {
  unsaved.delete(id);
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    // ignore
  }
}

async function flush(id) {
  let result = { ok: true, unauthorized: false };

  while (pending.has(id)) {
    const { data, token } = pending.get(id);
    pending.delete(id);

    try {
      await patchBridge(id, data, token);
      result = { ok: true, unauthorized: false };
    } catch (err) {
      result = { ok: false, unauthorized: err?.message === "UNAUTHORIZED" };
      console.error("Bridge autosave failed", err);
    }
  }

  running.delete(id);
  if (result.ok) forget(id);
  return result;
}

/**
 * Queue a save. Resolves to { ok, unauthorized } for the newest data.
 */
export function queueBridgeSave(id, data) {
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    // ignore
  }

  // Merge with any change not yet confirmed, so every send carries the
  // full unconfirmed picture (e.g. a goal edit right after Stop keeps
  // the stop). Newer fields win.
  const entry = { data: { ...unsaved.get(id)?.data, ...data }, token };
  pending.set(id, entry);
  remember(id, entry);

  if (!running.has(id)) {
    running.set(id, flush(id));
  }
  return running.get(id);
}

/**
 * Data for this bridge that the server never confirmed (e.g. the page
 * closed mid-save, or the session ended), or null.
 */
export function getUnsavedBridgeChanges(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Leaving the page: send anything not yet confirmed
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    unsaved.forEach(({ data, token }, id) => patchBridgeKeepalive(id, data, token));
  });
}
