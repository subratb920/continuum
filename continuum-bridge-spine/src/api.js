import { logger } from "./utils/logger";
import { normalizeProject } from "./models/project";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const TOKEN_KEY = "continuum_token";

if (!API_BASE) {
  throw new Error("VITE_API_BASE_URL is not defined");
}

/**
 * --------------------------------------------------
 * Core request helper (SINGLE SOURCE OF TRUTH)
 * --------------------------------------------------
 */
async function request(method, path, body, tokenOverride) {
  // tokenOverride: used by bridge autosave so a save goes out with the
  // login it was made under, even if another tab signed out meanwhile
  const token = tokenOverride ?? localStorage.getItem(TOKEN_KEY);

  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  logger.api("REQUEST", { method, path, body });

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;

  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  logger.api("RESPONSE", {
    method,
    path,
    status: res.status,
    data,
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

/* ==================================================
   Bridge APIs
   ================================================== */

export async function startInterval({
  projectId,
  mode,
  duration,
  sessionGoals,
  ticketUrl,
}) {
  return request("POST", "/bridges/start", {
    projectId,
    interval: { mode, duration },
    sessionGoals,
    ticketUrl,
  });
}

export async function finalizeBridge(bridgeId, sessionGoals) {
  if (!bridgeId) return;

  await request("PATCH", `/bridges/${bridgeId}`, {
    status: "finalized",
    ended: true,
    sessionGoals,
  });
}

export async function fetchBridges(projectId) {
  return request("GET", `/projects/${projectId}/bridges`);
}

export async function patchBridge(id, data, token) {
  await request("PATCH", `/bridges/${id}`, data, token);
}

/**
 * Fire-and-forget PATCH that survives the page closing (keepalive).
 * Used by bridge autosave on page hide. Skipped without a token.
 */
export function patchBridgeKeepalive(id, data, tokenOverride) {
  const token = tokenOverride ?? localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  try {
    fetch(`${API_BASE}/bridges/${id}`, {
      method: "PATCH",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
    });
  } catch {
    // best effort only
  }
}

/* ==================================================
   Project APIs
   ================================================== */

/**
 * extra (Import from device): { source: "device", contents: { folder, entries: [[path, size]], truncated } }
 */
export async function createProject(name, extra = {}) {
  const res = await request("POST", "/projects", { name, ...extra });
  const c = extra.contents;

  return normalizeProject({
    ...res,
    name, // backend may not return name
    source: extra.source ?? "local",
    // The summary the project list carries (the files themselves load when the tree opens)
    contents: c
      ? { folder: c.folder, fileCount: c.entries.length, totalBytes: c.entries.reduce((n, [, s]) => n + s, 0), truncated: c.truncated, importedAt: new Date().toISOString() }
      : undefined,
  });
}

/** A device project's files: { folder, importedAt, fileCount, totalBytes, truncated, entries: [[path, size]] } */
export async function fetchProjectContents(projectId) {
  return request("GET", `/projects/${projectId}/contents`);
}

export async function fetchProjects() {
  const res = await request("GET", "/projects");

  return res.map(normalizeProject);
}

export async function renameProject(projectId, name) {
  const res = await request("PATCH", `/projects/${projectId}`, { name });

  return normalizeProject(res);
}

export async function deleteProject(projectId) {
  await request("DELETE", `/projects/${projectId}`);
}

/* ==================================================
   Execution State APIs
   ================================================== */

export async function fetchActiveProject() {
  const res = await fetch(`${API_BASE}/execution/active-project`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("continuum_token")}`,
    },
  });

  if (res.status === 304) {
    return { activeProject: null };
  }

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error("Failed to fetch active project");
  }

  const data = await res.json();

  return {
    activeProject: data?.activeProject
      ? normalizeProject(data.activeProject)
      : null,
  };
}

export async function activateProject(projectId) {
  await request("POST", "/execution/activate-project", { projectId });
}

export async function deactivateProject() {
  await request("POST", "/execution/deactivate-project");
}
/* ==================================================
   Support
   ================================================== */

/** Contact us → Request a callback: { name, phone, bestTime: asap|morning|afternoon|evening, timezone, note } */
export async function requestCallback(details) {
  return request("POST", "/support/callbacks", details);
}
