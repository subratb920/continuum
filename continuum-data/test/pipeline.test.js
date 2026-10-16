import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startTestEngine, startWorker, waitFor } from "./helpers.js";
import { TemporaryJobError } from "../src/errors.js";

let t;
let ingestCalls = 0;
let crashOnce = true;

before(async () => {
  t = await startTestEngine({
    name: "pipeline",
    behaviour: {
      // The first ingest of the "crash" dataset dies mid-step, as if the API were killed
      async ingest(spec, onLine, signal) {
        ingestCalls++;
        if (spec.params.output.includes(t.crashDatasetId ?? "none") && crashOnce) {
          crashOnce = false;
          onLine({ kind: "log", message: "halfway" });
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
          throw signal.reason;
        }
      },
    },
  });
});
after(() => t.stop());

async function seedSource(api) {
  const { body } = await api("GET", "/sources?q=imdb");
  return body.sources.find((s) => s.ref === "stanfordnlp/imdb");
}

test("the catalogue starts from the seed list and grows from live searches", async () => {
  const api = t.api(t.users.a);
  const seeded = await api("GET", "/sources");
  assert.equal(seeded.status, 200);
  assert.ok(seeded.body.sources.length >= 20);
  assert.ok(seeded.body.sources.every((s) => s.licence.plain));
  const live = await api("GET", "/sources?q=found&live=1");
  assert.ok(live.body.sources.some((s) => s.ref === "someone/found-it"), "a search result is saved");
  const again = await api("GET", "/sources?q=found");
  assert.ok(again.body.sources.some((s) => s.ref === "someone/found-it"), "and found later without searching online");
});

test("a dataset from a source is fetched, ingested and profiled", async () => {
  const api = t.api(t.users.a);
  const source = await seedSource(api);
  const made = await api("POST", "/datasets", { name: "Movie reviews", goal: "tell good reviews from bad", sourceId: source.id });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.dataset.id;
  const ready = await waitFor(async () => {
    const { body } = await api("GET", `/datasets/${id}`);
    return body.dataset.state === "ready" && body.dataset;
  });
  assert.equal(ready.rows, 3);
  assert.equal(ready.versionCount, 1);
  assert.deepEqual(ready.lastRun.steps.map((s) => [s.op, s.state]), [["fetch", "succeeded"], ["ingest", "succeeded"], ["profile", "succeeded"]]);
  const v = (await api("GET", `/datasets/${id}/versions`)).body.versions;
  assert.equal(v.length, 1);
  assert.equal(v[0].profileSummary.rows, 3);
  const profile = await api("GET", `/versions/${v[0].id}/profile`);
  assert.equal(profile.body.profile.rows, 3);
  const events = await api("GET", `/runs/${ready.lastRun.id}/events`);
  assert.ok(events.body.events.some((e) => e.message === "Finished."));
  assert.ok(events.body.events.every((e, i) => e.seq === i + 1), "events are numbered in order");
  // the download is removed once the dataset is made
  const fetchStep = t.engine.runner.calls.find((c) => c.op === "fetch" && c.params.output.includes(ready.lastRun.id));
  await assert.rejects(readFile(path.join(t.store, t.users.a, fetchStep.params.output, "train", "0000.parquet")));
  const dup = await api("POST", "/datasets", { name: "Movie reviews", sourceId: source.id });
  assert.equal(dup.status, 409);
});

test("an upload becomes a dataset; paths can't leave the upload", async () => {
  const api = t.api(t.users.a);
  const up = await api("POST", "/uploads", { name: "My spreadsheet" });
  assert.equal(up.status, 201);
  const bad = await api("POST", `/uploads/${up.body.uploadId}/files?path=../../escape.csv`, new TextEncoder().encode("a,b\n1,2\n"), { "Content-Type": "application/octet-stream" });
  assert.equal(bad.status, 400);
  const ok = await api("POST", `/uploads/${up.body.uploadId}/files?path=data/my.csv`, new TextEncoder().encode("a,b\n1,2\n"), { "Content-Type": "application/octet-stream" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await readFile(path.join(t.store, t.users.a, "uploads", up.body.uploadId, "data", "my.csv"), "utf8"), "a,b\n1,2\n");
  const made = await api("POST", "/datasets", { name: "Spreadsheet", uploadId: up.body.uploadId });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.dataset.lastRun.steps.map((s) => s.op), ["ingest", "profile"]);
  await waitFor(async () => (await api("GET", `/datasets/${made.body.dataset.id}`)).body.dataset.state === "ready");
  const reuse = await api("POST", "/datasets", { name: "Spreadsheet again", uploadId: up.body.uploadId });
  assert.equal(reuse.status, 409, "an upload is used once");
});

test("a step killed halfway is run again, and writes exactly one version", async () => {
  const api = t.api(t.users.a);
  const source = await seedSource(api);
  // Stop the normal worker; this test drives workers by hand
  await t.engine.worker.stop(1000);
  const made = await api("POST", "/datasets", { name: "Crash test", sourceId: source.id });
  t.crashDatasetId = made.body.dataset.id;
  const before = ingestCalls;

  // Worker A takes the job, then "dies" in the ingest step: its lease is never renewed
  const a = await startWorker(t.engine, { workerId: "dies", leaseMs: 400, heartbeatMs: 60_000 });
  await waitFor(() => ingestCalls > before);
  a.running = false; // stop claiming; the in-flight step hangs as if the process were frozen

  // Worker B finds the expired lease and finishes the run
  await startWorker(t.engine, { workerId: "survivor" });
  const ready = await waitFor(async () => {
    const { body } = await api("GET", `/datasets/${t.crashDatasetId}`);
    return body.dataset.state === "ready" && body.dataset;
  });
  for (const f of a.inFlight.values()) f.controller.abort(new Error("gone"));
  assert.equal(ready.versionCount, 1);
  assert.equal(await t.engine.db.collection("versions").countDocuments({ datasetId: (await t.engine.db.collection("datasets").findOne({ name: "Crash test" }))._id }), 1);
  const names = t.engine.runner.calls.filter((c) => c.op === "ingest" && c.params.output.includes(t.crashDatasetId)).map((c) => c.name);
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1], "each try has its own container name");
  assert.equal(names[0].split("-").slice(0, 3).join("-"), names[1].split("-").slice(0, 3).join("-"));
});

test("a step that fails ends the run; retry continues from it", async () => {
  const api = t.api(t.users.b);
  const source = await seedSource(api);
  let failNext = true;
  const original = t.engine.runner.run;
  t.engine.runner.run = async (spec, onLine, signal) => {
    if (spec.op === "profile" && failNext) {
      failNext = false;
      onLine({ kind: "error", code: "BROKEN", message: "The file is broken." });
      return 1;
    }
    return original(spec, onLine, signal);
  };
  try {
    const made = await api("POST", "/datasets", { name: "Fails once", sourceId: source.id });
    const run = await waitFor(async () => {
      const r = (await api("GET", `/runs/${made.body.dataset.lastRun.id}`)).body.run;
      return r.state === "failed" && r;
    });
    assert.equal(run.error.message, "The file is broken.");
    assert.equal(run.steps[2].state, "failed");
    const retried = await api("POST", `/runs/${run.id}/retry`);
    assert.equal(retried.status, 200);
    const done = await waitFor(async () => {
      const r = (await api("GET", `/runs/${run.id}`)).body.run;
      return r.state === "succeeded" && r;
    });
    assert.equal(done.steps.filter((s) => s.op === "ingest").length, 1);
    assert.equal((await api("GET", `/datasets/${made.body.dataset.id}`)).body.dataset.versionCount, 1);
  } finally {
    t.engine.runner.run = original;
  }
});

test("a temporary runner problem is retried by the queue", async () => {
  const api = t.api(t.users.b);
  const source = await seedSource(api);
  let failures = 1;
  const original = t.engine.runner.run;
  t.engine.runner.run = async (spec, onLine, signal) => {
    if (spec.op === "fetch" && failures-- > 0) throw new TemporaryJobError("RUNNER_UNREACHABLE", "Docker is away");
    return original(spec, onLine, signal);
  };
  // the queue waits about 5 s before a retry; make it immediate for the test
  const jobs = t.engine.db.collection("jobs");
  const nudge = setInterval(() => jobs.updateMany({ status: "queued", type: "run.advance" }, { $set: { runAt: new Date(0) } }).catch(() => {}), 100);
  try {
    const made = await api("POST", "/datasets", { name: "Flaky", sourceId: source.id });
    await waitFor(async () => (await api("GET", `/datasets/${made.body.dataset.id}`)).body.dataset.state === "ready");
  } finally {
    clearInterval(nudge);
    t.engine.runner.run = original;
  }
});
