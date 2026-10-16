import { ObjectId } from "mongodb";
import { eventView } from "../runs.js";

/** Change streams need a replica set: code 40573 ("only supported on replica sets"). */
const notReplicaSet = (err) => err?.code === 40573 || /replica set/i.test(err?.message ?? "");

/**
 * Live run events (spec 5.4), as continuum-brain's live.ts: one change stream
 * on run_events per process, handed out to each user's open connections.
 * The browser reads it with fetch (so the sign-in stays in a header, never
 * in the address); GET /data/runs/:id/events catches up after a gap.
 */
export function createLive(db, log) {
  const listeners = new Map(); // userId → Set<fn>
  let stream = null;
  let poller = null;
  let stopped = false;

  const deliver = (e) => {
    for (const fn of listeners.get(String(e.userId)) ?? []) fn(eventView(e));
  };

  function open() {
    if (stopped) return;
    stream = db.collection("run_events").watch([{ $match: { operationType: "insert" } }], { fullDocument: "required" });
    stream.on("change", (c) => deliver(c.fullDocument));
    stream.on("error", (err) => {
      stream?.close().catch(() => {});
      stream = null;
      if (notReplicaSet(err)) {
        log.info("data events: the database isn't a replica set; reading new events every second instead");
        poll();
        return;
      }
      log.warn({ err }, "data events stream stopped; reopening");
      setTimeout(open, 2_000).unref();
    });
  }

  /**
   * Without change streams (a single MongoDB server, as continuum-api's in
   * the cloud): new events by their ids, a few seconds back each time (ids
   * made by another process may arrive a little late), each sent once.
   */
  function poll() {
    const sent = new Map(); // id → when sent
    let since = Math.floor(Date.now() / 1000);
    const tick = async () => {
      if (stopped) return;
      try {
        const from = ObjectId.createFromTime(since - 5);
        const fresh = await db.collection("run_events").find({ _id: { $gt: from } }).sort({ _id: 1 }).limit(1000).toArray();
        const now = Date.now();
        for (const e of fresh) {
          const id = String(e._id);
          if (sent.has(id)) continue;
          sent.set(id, now);
          deliver(e);
          since = Math.max(since, e._id.getTimestamp().getTime() / 1000);
        }
        for (const [id, at] of sent) if (now - at > 60_000) sent.delete(id);
      } catch (err) {
        log.warn({ err }, "data events: reading new events failed; trying again");
      }
      if (stopped) return;
      poller = setTimeout(tick, 1_000);
      poller.unref?.();
    };
    tick();
  }

  return {
    start: open,
    async stop() {
      stopped = true;
      clearTimeout(poller);
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
