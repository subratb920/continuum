import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startTestEngine, waitFor } from "./helpers.js";
import { normaliseSteps, suggestSteps, EXPORT_FORMATS_FOR } from "../src/recipes.js";

let t;
before(async () => {
  t = await startTestEngine({ name: "media" });
});
after(() => t.stop());

test("pictures and sound get their own steps and suggestions", () => {
  const img = suggestSteps({ findings: [{ suggest: "resize" }, { suggest: "filter" }], labels: { counts: [1, 2] } }, "image", { train: 9 });
  assert.deepEqual(img.map((s) => s.op), ["dedupe", "filter", "resize", "split", "validate"]);
  const audio = suggestSteps({ findings: [{ suggest: "resample" }], task: "transcribe" }, "audio", null);
  assert.deepEqual(audio.map((s) => s.op), ["dedupe", "resample", "redact_pii", "split", "validate"]);
  assert.equal(normaliseSteps([{ op: "resize" }], "image")[0].params.size, 224);
  assert.equal(normaliseSteps([{ op: "resample", params: { sampleRate: "16000" } }], "audio")[0].params.sampleRate, 16000);
  assert.throws(() => normaliseSteps([{ op: "resample", params: { sampleRate: 12345 } }], "audio"), /must be one of/);
  assert.throws(() => normaliseSteps([{ op: "resize" }], "text"), /doesn't work/);
  assert.throws(() => normaliseSteps([{ op: "safety" }], "image"), /doesn't work/);
  assert.deepEqual(EXPORT_FORMATS_FOR.image, ["hf", "imagefolder", "parquet"]);
});

test("media files are served only by their content name, and only to their owner", async () => {
  const api = t.api(t.users.a);
  const source = (await api("GET", "/sources?q=imdb")).body.sources[0];
  const made = await api("POST", "/datasets", { name: "Pics", sourceId: source.id });
  const ds = await waitFor(async () => {
    const { body } = await api("GET", `/datasets/${made.body.dataset.id}`);
    return body.dataset.state === "ready" && body.dataset;
  });
  const hash = "ab".padEnd(64, "c");
  const rel = `media/ab/${hash}.png`;
  const full = path.join(t.store, t.users.a, "datasets", ds.id, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "PNGDATA");
  const ok = await fetch(`${t.base}/versions/${ds.headVersionId}/media?path=${encodeURIComponent(rel)}`, { headers: { "x-test-user": t.users.a } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(await ok.text(), "PNGDATA");
  for (const bad of ["../../../etc/passwd", "media/ab/../../x.png", `media/ab/${hash}.exe`, "data/part-00000.parquet"]) {
    const r = await fetch(`${t.base}/versions/${ds.headVersionId}/media?path=${encodeURIComponent(bad)}`, { headers: { "x-test-user": t.users.a } });
    assert.equal(r.status, 400, bad);
  }
  const other = await fetch(`${t.base}/versions/${ds.headVersionId}/media?path=${encodeURIComponent(rel)}`, { headers: { "x-test-user": t.users.b } });
  assert.equal(other.status, 404);
  // text datasets can't be downloaded as picture folders
  const ex = await api("POST", `/versions/${ds.headVersionId}/exports`, { format: "imagefolder" });
  assert.equal(ex.status, 400);
});
