// src/brain/client.js
//
// continuum-brain's brain-api (BRAIN_URL, an internal address, never public),
// called for one user at a time with BRAIN_INTERNAL_TOKEN.
//
// Short calls (call/send) are capped in flight (backpressure), so a slow brain
// can't tie up every API worker: past the cap, a call is refused at once
// ("busy") instead of piling up. Connections to the brain are reused via Node's
// built-in keep-alive fetch pool. The event stream (SSE) is long-lived, so it's
// left off the call cap — open browser tabs don't use up slots for short calls.

export class BrainUnavailableError extends Error {}

const num = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

export function brainClient(baseUrl, token, fetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = (userId, json) => ({ "X-Brain-Token": token, "X-Continuum-User": String(userId), ...(json ? { "Content-Type": "application/json" } : {}) });

  // Backpressure: at most this many short calls in flight at once; past it, callers get "busy" instead of hanging
  const maxInflight = num("BRAIN_MAX_INFLIGHT", 64);
  let inFlight = 0;
  async function withSlot(fn) {
    if (inFlight >= maxInflight) throw new BrainUnavailableError("The brain is busy right now. Try again in a moment.");
    inFlight++;
    try {
      return await fn();
    } finally {
      inFlight--;
    }
  }

  /** { status, data } of one call. */
  async function call(userId, method, path, body, timeoutMs = 30_000) {
    return withSlot(async () => {
      let res;
      try {
        res = await fetchImpl(`${base}${path}`, { method, headers: headers(userId, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
      }
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    });
  }

  /**
   * { status, data } of a file sent as is (a project folder's .tar.gz). `bytes`
   * may be a Buffer, or a readable stream to pipe straight through (so a 60 MB
   * upload isn't held in memory before it's forwarded).
   */
  async function send(userId, path, bytes, contentType = "application/gzip", timeoutMs = 120_000) {
    return withSlot(async () => {
      let res;
      try {
        const streamed = bytes && typeof bytes.pipe === "function"; // a Node readable (fetch needs duplex for a streaming body)
        res = await fetchImpl(`${base}${path}`, { method: "POST", headers: { ...headers(userId, false), "Content-Type": contentType }, body: bytes, signal: AbortSignal.timeout(timeoutMs), ...(streamed ? { duplex: "half" } : {}) });
      } catch {
        throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
      }
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    });
  }

  /** The user's live events (server-sent events), until `signal` aborts. Long-lived: kept off the short-call pool. */
  async function stream(userId, query, signal) {
    try {
      return await fetchImpl(`${base}/events?${new URLSearchParams(query)}`, { headers: { ...headers(userId, false), Accept: "text/event-stream" }, signal });
    } catch {
      throw new BrainUnavailableError("The brain isn't reachable right now. Try again in a moment.");
    }
  }

  return { call, send, stream };
}
