import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectStore, ensureSchema } from "../src/store/db.js";
import { backoffMs, claim, complete, enqueue, fail, heartbeat, LeaseLostError, reschedule } from "../src/store/queue.js";
import { MONGO_URI } from "./helpers.js";

let client, db;
before(async () => {
  ({ client, db } = await connectStore(MONGO_URI, `continuum_data_test_queue_${process.pid}`));
  await ensureSchema(db);
});
after(async () => {
  await db.dropDatabase();
  await client.close();
});

test("only one worker wins a job", async () => {
  await db.collection("jobs").deleteMany({});
  await enqueue(db, { type: "t" });
  const now = new Date();
  const [a, b] = await Promise.all([claim(db, "a", now, 60_000), claim(db, "b", now, 60_000)]);
  assert.equal([a, b].filter(Boolean).length, 1);
});

test("an expired lease is taken over with a higher token, and the old holder can't write", async () => {
  await db.collection("jobs").deleteMany({});
  await enqueue(db, { type: "t" });
  const t0 = new Date();
  const first = await claim(db, "a", t0, 1_000);
  assert.equal(first.fencingToken, 1);
  const later = new Date(t0.getTime() + 5_000);
  const second = await claim(db, "b", later, 60_000);
  assert.equal(second.fencingToken, 2);
  assert.equal(second.attempts, 1, "a takeover counts as an attempt");
  assert.equal(await heartbeat(db, first, later, 60_000), false);
  await assert.rejects(complete(db, first, later), LeaseLostError);
  await complete(db, second, later);
  assert.equal((await db.collection("jobs").findOne({ _id: second._id })).status, "succeeded");
});

test("reschedule is not an attempt; failures back off and then end", async () => {
  await db.collection("jobs").deleteMany({});
  await enqueue(db, { type: "t", maxAttempts: 2 });
  let now = new Date();
  let job = await claim(db, "a", now, 60_000);
  await reschedule(db, job, now, 0);
  job = await claim(db, "a", now, 60_000);
  assert.equal(job.attempts, 0);
  assert.equal(await fail(db, job, now, { code: "X", message: "x", permanent: false }, () => 0.5), "queued");
  now = new Date(now.getTime() + 60_000);
  job = await claim(db, "a", now, 60_000);
  assert.equal(await fail(db, job, now, { code: "X", message: "x", permanent: false }), "dead");
});

test("back-off doubles up to its cap", () => {
  const exact = { random: () => 0.5 };
  assert.equal(backoffMs(1, exact), 5_000);
  assert.equal(backoffMs(2, exact), 10_000);
  assert.equal(backoffMs(20, exact), 300_000);
});
