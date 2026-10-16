import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestEngine, waitFor } from "./helpers.js";
import { normaliseSteps, suggestSteps, VERSION_OPS, STEP_CATALOG } from "../src/recipes.js";

let t;
before(async () => {
  t = await startTestEngine({ name: "recipes" });
});
after(() => t.stop());

async function readyDataset(api, name) {
  const source = (await api("GET", "/sources?q=imdb")).body.sources[0];
  const made = await api("POST", "/datasets", { name, sourceId: source.id });
  return waitFor(async () => {
    const { body } = await api("GET", `/datasets/${made.body.dataset.id}`);
    return body.dataset.state === "ready" && body.dataset;
  });
}

test("steps are checked and get their defaults; unknown ones are refused", () => {
  const out = normaliseSteps([{ op: "dedupe" }, { op: "split", params: { ratios: [0.7, 0.15, 0.15] } }, { op: "filter", enabled: false }], "text");
  assert.deepEqual(out.map((s) => s.op), ["dedupe", "split"]);
  assert.equal(out[0].params.mode, "near");
  assert.equal(out[1].params.seed, 42);
  assert.throws(() => normaliseSteps([{ op: "rm -rf" }], "text"), /isn't a step/);
  assert.throws(() => normaliseSteps([{ op: "dedupe", params: { nope: 1 } }], "text"), /no setting/);
  assert.throws(() => normaliseSteps([{ op: "split", params: { ratios: [0.5, 0.1, 0.1] } }], "text"), /add up to 1/);
  assert.throws(() => normaliseSteps([{ op: "fill_missing" }], "text"), /doesn't work/);
  assert.throws(() => normaliseSteps([], "text"), /at least one/);
  for (const op of VERSION_OPS) assert.ok(STEP_CATALOG[op], op);
});

test("the suggested recipe follows the profile's findings", () => {
  const steps = suggestSteps({ findings: [{ suggest: "dedupe" }, { suggest: "filter" }], labels: { counts: [1] } }, "text", { train: 10 });
  assert.deepEqual(steps.map((s) => s.op), ["redact_pii", "safety", "dedupe", "filter", "split", "validate"]);
  assert.equal(steps.find((s) => s.op === "split").params.mode, "stratified");
  assert.equal(suggestSteps({ findings: [] }, "text", { train: 8, test: 2 }).find((s) => s.op === "split").params.mode, "keep");
});

test("a pipeline makes one version per step, chained, then measures and checks it", async () => {
  const api = t.api(t.users.a);
  const ds = await readyDataset(api, "Pipeline one");
  const run = await api("POST", "/runs", { datasetId: ds.id, steps: [{ op: "dedupe" }, { op: "split" }, { op: "validate" }] });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.deepEqual(run.body.run.steps.map((s) => s.op), ["dedupe", "split", "validate", "profile"]);
  const done = await waitFor(async () => {
    const r = (await api("GET", `/runs/${run.body.run.id}`)).body.run;
    return r.state === "succeeded" && r;
  });
  const versions = (await api("GET", `/datasets/${ds.id}/versions`)).body.versions;
  assert.deepEqual(versions.map((v) => v.number), [3, 2, 1]);
  const [v3, v2, v1] = versions;
  assert.equal(v2.parentVersionId, v1.id);
  assert.equal(v3.parentVersionId, v2.id);
  assert.equal(v2.madeBy.op, "dedupe");
  assert.equal(v2.changes.removed, 1);
  assert.equal(v3.madeBy.op, "split");
  assert.equal(v3.madeBy.params.seed, 42);
  assert.equal(v3.quality.score, 90);
  assert.ok(v3.profileSummary, "the last version is measured");
  assert.equal(done.steps[0].result.removed, 1);
  const runner = t.engine.runner.calls.filter((c) => c.name.includes(run.body.run.id));
  assert.equal(runner[1].params.input, runner[0].params.output, "each step reads the one before");
  assert.equal((await api("GET", `/versions/${v2.id}/changes`)).body.changes.removed, 1);
  assert.equal((await api("GET", `/versions/${v3.id}/quality`)).body.quality.score, 90);
  const ds2 = (await api("GET", `/datasets/${ds.id}`)).body.dataset;
  assert.equal(ds2.headVersionId, v3.id);
});

test("privacy, safety, balance and chat steps run in a pipeline", async () => {
  const api = t.api(t.users.a);
  const ds = await readyDataset(api, "Pipeline three");
  const run = await api("POST", "/runs", { datasetId: ds.id, steps: [{ op: "redact_pii" }, { op: "safety", params: { extraWords: "spoiler, boring" } }, { op: "split" }, { op: "balance" }, { op: "to_chat", params: { mode: "classify" } }] });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const call = (op) => t.engine.runner.calls.find((c) => c.op === op && c.name.includes(run.body.run.id));
  await waitFor(async () => (await api("GET", `/runs/${run.body.run.id}`)).body.run.state === "succeeded");
  assert.deepEqual(call("safety").params.extraWords, ["spoiler", "boring"]);
  assert.equal(call("redact_pii").params.action, "replace");
  assert.equal(call("balance").params.method, "under");
  const bad = await api("POST", "/runs", { datasetId: ds.id, steps: [{ op: "redact_pii", params: { kinds: ["dna"] } }] });
  assert.equal(bad.status, 400);
});

test("templates, saved recipes and suggestions run the same way", async () => {
  const api = t.api(t.users.a);
  const ds = await readyDataset(api, "Pipeline two");
  const templates = (await api("GET", "/recipes/templates")).body.templates;
  assert.ok(templates.find((x) => x.id === "text-classifier"));
  const saved = await api("POST", "/recipes", { name: "Mine", modality: "text", steps: [{ op: "filter", params: { minChars: 3 } }] });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const sug = await api("GET", `/datasets/${ds.id}/suggested-recipe`);
  assert.ok(sug.body.steps.length >= 2);
  const r = await api("POST", "/runs", { datasetId: ds.id, recipeId: saved.body.recipe.id });
  assert.equal(r.status, 201);
  assert.equal(r.body.run.recipeName, "Mine");
  await waitFor(async () => (await api("GET", `/runs/${r.body.run.id}`)).body.run.state === "succeeded");
  const bad = await api("POST", "/runs", { datasetId: ds.id, steps: [{ op: "fill_missing" }] });
  assert.equal(bad.status, 400);
  assert.equal((await t.api(t.users.b)("POST", "/runs", { datasetId: ds.id, steps: [{ op: "dedupe" }] })).status, 404);
  assert.equal((await t.api(t.users.b)("GET", `/recipes`)).body.recipes.length, 0);
});

test("export makes a download; publish freezes the version", async () => {
  const api = t.api(t.users.a);
  const ds = await readyDataset(api, "Exported");
  const vid = ds.headVersionId;
  const bad = await api("POST", `/versions/${vid}/exports`, { format: "exe" });
  assert.equal(bad.status, 400);
  const ex = await api("POST", `/versions/${vid}/exports`, { format: "hf" });
  assert.equal(ex.status, 202);
  const call = await waitFor(() => t.engine.runner.calls.find((c) => c.op === "export" && c.params.input.includes(vid)));
  assert.equal(call.params.card.name, "Exported");
  assert.equal(call.params.card.sources[0].licence.spdx, "other");
  assert.deepEqual(call.params.card.history.map((h) => h.label), ["Read and tidy up"]);
  await waitFor(async () => (await api("GET", `/versions/${vid}`)).body.version.exports.hf);
  const res = await fetch(`${t.base}/versions/${vid}/exports/hf/download`, { headers: { "x-test-user": t.users.a } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /Exported-v1-hf\.zip/);
  assert.equal(await res.text(), "PKzip");
  const other = await fetch(`${t.base}/versions/${vid}/exports/hf/download`, { headers: { "x-test-user": t.users.b } });
  assert.equal(other.status, 404);
  const after = (await api("GET", `/datasets/${ds.id}`)).body.dataset;
  assert.equal(after.lastRun.kind, "build", "an export doesn't replace the last build");
  const pub = await api("POST", `/versions/${vid}/publish`);
  assert.equal(pub.body.version.frozen, true);
  assert.equal((await api("GET", `/datasets/${ds.id}`)).body.dataset.publishedVersionId, vid);
});
