const API_BASE = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE) {
  throw new Error("VITE_API_BASE_URL is not defined");
}

export async function finalizeBridge(bridgeId) {
  if (!bridgeId) return;

  const res = await fetch(`${API_BASE}/bridges/${bridgeId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "final",
      "interval.endedAt": new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to finalize bridge");
  }
}

export async function startInterval({
  projectId,
  mode,
  duration,
  sessionGoals,
}) {
  const res = await fetch(`${API_BASE}/bridges/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      interval: {
        mode,
        duration,
      },
      sessionGoals,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to start interval");
  }

  return await res.json(); // returns Bridge
}


export async function fetchBridges(projectId) {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/bridges`
  );

  return await res.json();
}

export async function patchBridge(id, data) {
  await fetch(`${API_BASE}/bridges/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function createProject(name) {
  const res = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    throw new Error("Failed to create project");
  }

  return await res.json();
}

export async function fetchProjects() {
  const res = await fetch(`${API_BASE}/projects`);
  return await res.json();
}
