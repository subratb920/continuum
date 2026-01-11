const API_BASE = import.meta.env.VITE_API_BASE_URL;
const TOKEN_KEY = "continuum_token";

if (!API_BASE) {
  throw new Error("VITE_API_BASE_URL is not defined");
}

/**
 * --------------------------------------------------
 * Core request helper
 * --------------------------------------------------
 */
async function request(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 🔒 Auth collapse
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.reload();
    return;
  }

  if (!res.ok) {
    let message = "Request failed";
    try {
      const err = await res.json();
      message = err.error || message;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return null;

  return res.json();
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
  return request("POST", "/projects", { name });
}

export async function fetchProjects() {
  return request("GET", "/projects");
}

export async function deleteProject(projectId) {
  await request("DELETE", `/projects/${projectId}`);
}

/* ==================================================
   Execution State APIs
   ================================================== */

export async function fetchActiveProject() {
  return request("GET", "/execution/active-project");
}

export async function activateProject(projectId) {
  await request("POST", "/execution/activate-project", { projectId });
}
