// src/workspaces/client.js
//
// continuum-workspaces' internal API (WORKSPACES_URL, never public): start,
// open, stop, delete and status of a workspace. The user's GitHub sign-in is
// passed only to start one and is never stored by the service.

export class WorkspacesUnavailableError extends Error {}

export function workspacesClient(baseUrl, fetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  async function call(method, path, body, timeoutMs = 30_000, prefix = "/internal/workspaces/") {
    let res;
    try {
      res = await fetchImpl(`${base}${prefix}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WorkspacesUnavailableError("Workspaces aren't reachable right now. Try again in a moment.");
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  return {
    status: (id) => call("GET", id, undefined, 5_000),
    start: (id, body) => call("POST", `${id}/start`, body, 60_000),
    open: (id) => call("POST", `${id}/open`),
    stop: (id) => call("POST", `${id}/stop`),
    remove: (id) => call("DELETE", id),
    // The sandboxes this install can start (a service from before sandboxes: only "full")
    sandboxes: () => call("GET", "sandboxes", undefined, 5_000, "/internal/"),
  };
}
