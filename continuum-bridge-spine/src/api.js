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
      data = await res.json();   // ✅ READ ONCE
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

  return data; // ✅ RETURN SAME OBJECT
}

/* ==================================================
   Bridge APIs
   ================================================== */

export async function startInterval({
  projectId,
  mode,
  duration,
  sessionGoals,
}) {
  return request("POST", "/bridges/start", {
    projectId,
    interval: { mode, duration },
    sessionGoals,
  });
}

export async function finalizeBridge(bridgeId) {
  if (!bridgeId) return;

  await request("PATCH", `/bridges/${bridgeId}`, {
    status: "finalized",
    "interval.endedAt": new Date().toISOString(),
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

  // Normalize immediately
  return normalizeProject({
    ...res,
    name, // backend currently doesn't return name
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
  const token = localStorage.getItem("continuum_token");

  const res = await fetch(
    `${API_BASE}/execution/active-project`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  // ✅ 304 = no change, no body
  if (res.status === 304) {
    return { activeProject: null };
  }

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error("Failed to fetch active project");
  }

  return res.json();
}


export async function activateProject(projectId) {
  await request("POST", "/execution/activate-project", { projectId });
}

export async function deactivateProject() {
  await request("POST", "/execution/deactivate-project");
}
