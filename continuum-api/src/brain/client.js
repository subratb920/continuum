// src/brain/client.js
//
// continuum-brain's brain-api (BRAIN_URL, an internal address, never public),
// called for one user at a time with BRAIN_INTERNAL_TOKEN.

export class BrainUnavailableError extends Error {}

export function brainClient(baseUrl, token, fetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = (userId, json) => ({ "X-Brain-Token": token, "X-Continuum-User": String(userId), ...(json ? { "Content-Type": "application/json" } : {}) });

  /** { status, data } of one call. */
  async function call(userId, method, path, body, timeoutMs = 30_000) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers: headers(userId, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** { status, data } of a file sent as is (a project folder's .tar.gz): longer to send than a JSON call. */
  async function send(userId, path, bytes, contentType = "application/gzip", timeoutMs = 120_000) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method: "POST", headers: { ...headers(userId, false), "Content-Type": contentType }, body: bytes, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** The user's live events (server-sent events), until `signal` aborts. */
  async function stream(userId, query, signal) {
    try {
      return await fetchImpl(`${base}/events?${new URLSearchParams(query)}`, { headers: { ...headers(userId, false), Accept: "text/event-stream" }, signal });
    } catch {
      throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
    }
  }

  return { call, send, stream };
}
