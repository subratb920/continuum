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
async function request(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);

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

export async function patchBridge(id, data) {
  await request("PATCH", `/bridges/${id}`, data);
}

/* ==================================================
   Project APIs
   ================================================== */

export async function createProject(name) {
  const res = await request("POST", "/projects", { name });

  return normalizeProject({
    ...res,
    name, // backend may not return name
  });
}

export async function fetchProjects() {
  const res = await request("GET", "/projects");

  return res.map(normalizeProject);
}

export async function deleteProject(projectId) {
  await request("DELETE", `/projects/${projectId}`);
}

/* ==================================================
   Execution State APIs
   ================================================== */

export async function fetchActiveProject() {
  const data = await request("GET", "/execution/active-project");

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