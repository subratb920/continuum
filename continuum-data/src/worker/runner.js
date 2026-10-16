import { setTimeout as sleep } from "node:timers/promises";
import { claim, complete, fail, heartbeat, LeaseLostError, markDead, release, reschedule } from "../store/queue.js";
import { PermanentJobError, TemporaryJobError } from "../errors.js";

/**
 * The worker's job loop, as continuum-deploy's JobRunner: claims due jobs up
 * to the concurrency limit, keeps each lease alive, stops a handler the moment
 * its lease is lost, and on shutdown gives unfinished jobs back.
 *
 * A handler resolves with { kind: "done" } or { kind: "wait", delayMs }
 * (more to do: the same job continues, which is not an attempt).
 */
export class JobRunner {
  constructor({ db, log, workerId, handlers, concurrency = 2, leaseMs = 60_000, heartbeatMs = 20_000, pollMs = 1_000, idlePollMs = 5_000 }) {
    Object.assign(this, { db, log, workerId, handlers, concurrency, leaseMs, heartbeatMs, pollMs, idlePollMs });
    this.inFlight = new Map();
    this.running = false;
    this.loopDone = Promise.resolve();
  }

  start() {
    this.running = true;
    this.loopDone = this.loop();
  }

  async loop() {
    let idle = this.pollMs;
    while (this.running) {
      try {
        if (this.inFlight.size < this.concurrency) {
          const job = await claim(this.db, this.workerId, new Date(), this.leaseMs);
          if (job) {
            this.launch(job);
            idle = this.pollMs;
            continue;
          }
          idle = Math.min(idle * 2, this.idlePollMs);
        }
      } catch (err) {
        this.log.error({ err }, "data worker loop error; retrying");
      }
      await sleep(this.inFlight.size >= this.concurrency ? this.pollMs : idle);
    }
  }

  launch(job) {
    const controller = new AbortController();
    const id = String(job._id);
    const done = this.execute(job, controller).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, { job, controller, done });
  }

  async execute(job, controller) {
    const { db, leaseMs, heartbeatMs } = this;
    const jlog = this.log.child({ jobId: String(job._id), type: job.type, attempt: job.attempts });

    if (job.attempts >= job.maxAttempts) {
      await markDead(db, job, new Date(), "The job was taken over too many times (its worker kept stopping)").catch(() => {});
      jlog.warn("job dead: too many takeovers");
      return;
    }
    const handler = this.handlers[job.type];
    if (!handler) {
      await fail(db, job, new Date(), { code: "UNKNOWN_JOB_TYPE", message: `No handler for ${job.type}`, permanent: true }).catch(() => {});
      return;
    }

    const beat = setInterval(async () => {
      try {
        if (!(await heartbeat(db, job, new Date(), leaseMs))) {
          jlog.warn("lease lost: another worker took over; stopping");
          controller.abort(new LeaseLostError(job));
        }
      } catch (err) {
        jlog.warn({ err }, "heartbeat failed; will retry");
      }
    }, heartbeatMs);

    try {
      const result = await handler(job, { signal: controller.signal, log: jlog });
      if (controller.signal.aborted) return;
      if (result?.kind === "wait") await reschedule(db, job, new Date(), result.delayMs ?? 0);
      else await complete(db, job, new Date());
    } catch (err) {
      if (controller.signal.aborted || err instanceof LeaseLostError) return;
      const permanent = err instanceof PermanentJobError;
      const code = err instanceof PermanentJobError || err instanceof TemporaryJobError ? err.code : "UNEXPECTED_ERROR";
      const message = err instanceof Error ? err.message : String(err);
      if (!permanent) jlog.warn({ err, code }, "data job failed; it will be retried");
      try {
        await fail(db, job, new Date(), { code, message, permanent });
      } catch (e) {
        if (!(e instanceof LeaseLostError)) jlog.error({ err: e }, "could not record the failure");
      }
    } finally {
      clearInterval(beat);
    }
  }

  async stop(graceMs = 10_000) {
    this.running = false;
    await this.loopDone;
    const all = Promise.all([...this.inFlight.values()].map((f) => f.done));
    const timedOut = await Promise.race([all.then(() => false), sleep(graceMs).then(() => true)]);
    if (!timedOut) return;
    for (const f of this.inFlight.values()) {
      f.controller.abort(new Error("worker shutting down"));
      await release(this.db, f.job, new Date()).catch(() => {});
    }
    await all;
  }
}
