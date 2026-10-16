import { ObjectId } from "mongodb";

/**
 * The lease queue (spec 5.2), the same rules as continuum-deploy's
 * packages/store/src/queue/jobs.ts: one atomic claim, leases kept alive by
 * heartbeats, a fencing token that rises on every claim so a stale worker can
 * always be told apart, and back-off on failure.
 */
export class LeaseLostError extends Error {
  constructor(job) {
    super(`Lease lost for job ${job._id} (token ${job.fencingToken})`);
    this.name = "LeaseLostError";
  }
}

const jobs = (db) => db.collection("jobs");

/** 5 s, 10 s, 20 s … at most 5 minutes, each with up to 20% jitter. */
export function backoffMs(attempt, { baseMs = 5_000, capMs = 300_000, jitter = 0.2, random = Math.random } = {}) {
  const raw = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), capMs);
  return Math.round(raw * (1 + (random() * 2 - 1) * jitter));
}

export async function enqueue(db, input, now = new Date()) {
  const doc = {
    _id: new ObjectId(),
    type: input.type,
    userId: input.userId ?? null,
    runId: input.runId ?? null,
    payload: input.payload ?? {},
    status: "queued",
    runAt: input.runAt ?? now,
    priority: input.priority ?? 100,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    fencingToken: 0,
    lease: null,
    lastError: null,
    repeatEvery: input.repeatEvery ?? null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  await jobs(db).insertOne(doc);
  return doc._id;
}

/** A queued job whose time has come, or a running one whose lease expired (its worker stopped). */
export async function claim(db, workerId, now, leaseMs) {
  return jobs(db).findOneAndUpdate(
    {
      $or: [
        { status: "queued", runAt: { $lte: now } },
        { status: "running", "lease.expiresAt": { $lt: now } },
      ],
    },
    [
      {
        $set: {
          attempts: { $cond: [{ $eq: ["$status", "running"] }, { $add: ["$attempts", 1] }, "$attempts"] },
          status: "running",
          fencingToken: { $add: [{ $ifNull: ["$fencingToken", 0] }, 1] },
          lease: { owner: workerId, expiresAt: new Date(now.getTime() + leaseMs), heartbeatAt: now },
          updatedAt: now,
        },
      },
    ],
    { sort: { priority: 1, runAt: 1 }, returnDocument: "after" },
  );
}

const held = (job) => ({ _id: job._id, status: "running", "lease.owner": job.lease?.owner, fencingToken: job.fencingToken });

export async function heartbeat(db, job, now, leaseMs) {
  const res = await jobs(db).updateOne(held(job), {
    $set: { "lease.expiresAt": new Date(now.getTime() + leaseMs), "lease.heartbeatAt": now, updatedAt: now },
  });
  return res.matchedCount === 1;
}

async function guarded(db, job, set) {
  const res = await jobs(db).updateOne(held(job), { $set: set });
  if (res.matchedCount === 0) throw new LeaseLostError(job);
}

export async function complete(db, job, now) {
  await guarded(db, job, { status: "succeeded", finishedAt: now, lease: null, lastError: null, updatedAt: now });
  if (job.repeatEvery) {
    const { type, userId, runId, payload, priority, maxAttempts, repeatEvery } = job;
    await enqueue(db, { type, userId, runId, payload, priority, maxAttempts, repeatEvery, runAt: new Date(now.getTime() + repeatEvery * 1000) }, now);
  }
}

/** More to do (the next step): continue soon. Not an attempt. */
export async function reschedule(db, job, now, delayMs) {
  await guarded(db, job, { status: "queued", runAt: new Date(now.getTime() + delayMs), lease: null, updatedAt: now });
}

export async function fail(db, job, now, failure, random = Math.random) {
  const attempts = job.attempts + 1;
  const lastError = { code: failure.code, message: failure.message };
  if (failure.permanent) {
    await guarded(db, job, { status: "failed", attempts, lastError, finishedAt: now, lease: null, updatedAt: now });
    return "failed";
  }
  if (attempts >= job.maxAttempts) {
    await guarded(db, job, { status: "dead", attempts, lastError, finishedAt: now, lease: null, updatedAt: now });
    return "dead";
  }
  const runAt = new Date(now.getTime() + backoffMs(attempts, { random }));
  await guarded(db, job, { status: "queued", attempts, lastError, runAt, lease: null, updatedAt: now });
  return "queued";
}

export async function release(db, job, now) {
  await guarded(db, job, { status: "queued", runAt: now, lease: null, updatedAt: now });
}

export async function markDead(db, job, now, message) {
  await guarded(db, job, { status: "dead", lastError: { code: "TOO_MANY_ATTEMPTS", message }, finishedAt: now, lease: null, updatedAt: now });
}

/** A recurring job, queued once however many times the engine starts. */
export async function ensureRecurring(db, type, repeatEvery, now = new Date()) {
  const open = await jobs(db).findOne({ type, status: { $in: ["queued", "running"] } });
  if (!open) await enqueue(db, { type, repeatEvery, maxAttempts: 3 }, now);
}
