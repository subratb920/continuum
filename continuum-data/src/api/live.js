import { eventView } from "../runs.js";

/**
 * Live run events (spec 5.4), as continuum-brain's live.ts: one change stream
 * on run_events per process, handed out to each user's open connections.
 * The browser reads it with fetch (so the sign-in stays in a header, never
 * in the address); GET /data/runs/:id/events catches up after a gap.
 */
export function createLive(db, log) {
  const listeners = new Map(); // userId → Set<fn>
  let stream = null;
  let stopped = false;

  function open() {
    if (stopped) return;
    stream = db.collection("run_events").watch([{ $match: { operationType: "insert" } }], { fullDocument: "required" });
    stream.on("change", (c) => {
      const e = c.fullDocument;
      for (const fn of listeners.get(String(e.userId)) ?? []) fn(eventView(e));
    });
    stream.on("error", (err) => {
      log.warn({ err }, "data events stream stopped; reopening");
      stream?.close().catch(() => {});
      setTimeout(open, 2_000).unref();
    });
  }

  return {
    start: open,
    async stop() {
      stopped = true;
      await stream?.close().catch(() => {});
    },
    /** GET /data/events */
    handler(req, res) {
      const userId = String(req.user.id);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(": connected\n\n");
      const send = (e) => res.write(`id: ${e.id}\nevent: run\ndata: ${JSON.stringify(e)}\n\n`);
      const set = listeners.get(userId) ?? new Set();
      set.add(send);
      listeners.set(userId, set);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        set.delete(send);
        if (!set.size) listeners.delete(userId);
      });
    },
  };
}
