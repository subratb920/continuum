import { logger } from "./utils/logger";
import { normalizeProject } from "./models/project";
import { leftSpace, spaceHeaders } from "./state/space";

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
    ...spaceHeaders(),
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

  // Not in that organization any more (left, or removed): back to your personal space
  if (res.status === 403 && data?.code === "NOT_IN_SPACE") leftSpace();

  if (!res.ok) {
    // field: which input was wrong (e.g. the New Project wizard highlights it)
    throw Object.assign(new Error(data?.error || "Request failed"), { field: data?.field ?? null, code: data?.code ?? null });
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
  kind = "human", // "agent": Continuum Brain works the goals (no duration)
  workFrom = "github", // an agent interval: "device" (your folder, sent from this computer) or "github"
  sessionGoals,
  ticketUrl,
}) {
  return request("POST", "/bridges/start", {
    projectId,
    interval: kind === "agent" ? { kind, mode, workFrom } : { mode, duration },
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
        ...spaceHeaders(),
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
 * extra (Import from device): { source: "device", contents: { folder, entries: [[path, size]], truncated }, githubRepoUrl? }
 */
export async function createProject(name, extra = {}) {
  const res = await request("POST", "/projects", { name, ...extra });
  const c = extra.contents;

  return normalizeProject({
    ...res,
    name, // backend may not return name
    source: extra.source ?? "local",
    githubRepoUrl: extra.githubRepoUrl ?? null,
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
      ...spaceHeaders(),
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

/* ==================================================
   Continuum Workspaces (a development server per project)
   ================================================== */

/** { items: [{ id, projectId, projectName, repo, size, state, lastOpenedAt }], limits, sizes } */
export async function fetchWorkspaces() {
  return request("GET", "/workspaces");
}

export async function createWorkspace(projectId, size, sandbox) {
  return request("POST", "/workspaces", { projectId, size, ...(sandbox ? { sandbox } : {}) });
}

/** Starts it when stopped (with a new size or sandbox, if given); { url } opens the editor (it carries a one-time access token) */
export async function openWorkspace(id, size, sandbox) {
  return request("POST", `/workspaces/${id}/open`, { ...(size ? { size } : {}), ...(sandbox ? { sandbox } : {}) });
}

export async function stopWorkspace(id) {
  return request("POST", `/workspaces/${id}/stop`);
}

export async function deleteWorkspace(id) {
  return request("DELETE", `/workspaces/${id}`);
}

/** Download from GitHub: the project's repository as a git clone (.tar.gz Response) */
export async function downloadProjectClone(projectId) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}/projects/${projectId}/clone`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...spaceHeaders() } });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "GitHub couldn't give the project's files.");
  }
  return res;
}

/**
 * "Put on GitHub": a new repository on the user's GitHub for a project that
 * has none, with the folder's files (a .tar.gz Blob) as the first commit, or
 * a README when there are none. → { project } with its GitHub link.
 */
export async function putProjectOnGithub(projectId, { name, isPrivate }, archive) {
  const token = localStorage.getItem(TOKEN_KEY);
  const q = new URLSearchParams({ name, private: isPrivate ? "1" : "0" });
  const res = await fetch(`${API_BASE}/projects/${projectId}/github?${q}`, {
    method: "POST",
    headers: { ...(archive ? { "Content-Type": "application/gzip" } : {}), ...(token && { Authorization: `Bearer ${token}` }), ...spaceHeaders() },
    body: archive ?? undefined,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || "The project couldn't be put on GitHub."), { field: data?.field ?? null });
  return data;
}

/**
 * Your project folder (a .tar.gz Blob from this computer) for the brain:
 * workers of an interval that works in your folder start from it.
 * → { id, files, bytes, createdAt }
 */
export async function uploadFolderSnapshot(projectId, archive) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}/brain/projects/${projectId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/gzip", ...(token && { Authorization: `Bearer ${token}` }), ...spaceHeaders() },
    body: archive,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Your folder couldn't be sent to the brain.");
  return data;
}

/* ==================================================
   New Project wizard
   ================================================== */

/** What Continuum can create: kinds, variants, options, details, dependencies. */
export async function fetchCreateCatalog() {
  return request("GET", "/create/catalog");
}

/** The files a set of choices would produce: { name, files: [[path, size]] } */
export async function previewNewProject(choices) {
  return request("POST", "/create/preview", choices);
}

/**
 * The generated project as a fetch Response holding a .tar.gz
 * (read it with utils/deviceFolder.js filesOfTarball). Headers:
 * X-Project-Name, X-Commit (when git was initialised).
 */
export async function generateNewProject(choices) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}/create/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }), ...spaceHeaders() },
    body: JSON.stringify(choices),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.error || "The project couldn't be created."), { field: data?.field ?? null });
  }
  return res;
}

/** Whether the user can create GitHub repositories: { connected, login?, reason? } */
export async function fetchGithubCreateStatus() {
  return request("GET", "/create/github");
}

/** Is this repository name free on the user's GitHub? { name, owner, available } */
export async function checkGithubRepoName(name) {
  return request("GET", `/create/github/available?name=${encodeURIComponent(name)}`);
}

/* ==================================================
   Preferences kept with the account (Continuum Deploy follows the theme)
   ================================================== */

/** { theme, chosen } (chosen: false while the user never picked one) */
export async function fetchAccountPreferences() {
  return request("GET", "/me/preferences");
}

export async function saveAccountTheme(theme) {
  return request("PATCH", "/me/preferences", { theme });
}

/** A one-time code (10 minutes) to sync your account's records into this Continuum: { code, expiresAt }. */
export async function createSyncCode() {
  return request("POST", "/me/sync-codes");
}

/* ==================================================
   Your spaces (continuum-directory): personal and your organizations.
   Running an organization is the Directory's page (directoryLinks.js)
   ================================================== */

export const orgsApi = {
  /** { spaces: [{ id, kind, name, orgId?, orgRole?, departmentIds? }], lastSpaceId, invites } */
  spaces: () => request("GET", "/directory/me/spaces"),
  setActive: (spaceId) => request("PUT", "/directory/me/spaces/active", { spaceId }),
  create: (name) => request("POST", "/directory/orgs", { name }),
  acceptInvite: (id) => request("POST", `/directory/me/invites/${id}/accept`),
  declineInvite: (id) => request("POST", `/directory/me/invites/${id}/decline`),
};
