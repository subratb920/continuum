import { createHash } from "node:crypto";
import { FINAL, updateRun, addEvent } from "../runs.js";

/**
 * Job handlers (spec 5.2). run.advance moves a run on by one step each time
 * it is claimed, then asks to continue at once, so a crash loses at most the
 * step in progress, and that step is simply run again.
 */
export const STEP_LABEL = {
  fetch: "Download",
  ingest: "Read and tidy up",
  profile: "Measure",
  dedupe: "Remove copies",
  filter: "Filter rows",
  fix_types: "Fix column kinds",
  fill_missing: "Fill empty cells",
  outliers: "Handle unusual numbers",
  split: "Split for training and testing",
  validate: "Check quality",
  export: "Pack for download",
};

const TIMEOUT_SEC = { fetch: 4 * 3600, ingest: 2 * 3600, profile: 3600 };
const DEFAULT_TIMEOUT_SEC = 2 * 3600;
const MAX_LOG_EVENTS = 400;
const PROGRESS_EVERY_MS = 2_000;

export function dataHandlers({ db, storage, runner, log }) {
  const datasets = db.collection("datasets");
  const versions = db.collection("versions");
  const runsCol = db.collection("runs");

  async function finish(run, state, error = null) {
    const now = new Date();
    run = await updateRun(db, run, { state, error, endedAt: now }, now);
    const dataset = await datasets.findOne({ _id: run.datasetId });
    if (dataset) {
      const dsState = state === "succeeded" || dataset.headVersionId ? "ready" : state;
      // An export run doesn't change what the dataset shows as its last build
      const set = run.kind === "export" ? { state: dataset.state === "building" ? dsState : dataset.state, updatedAt: now } : { state: dsState, lastRunId: run._id, updatedAt: now };
      await datasets.updateOne({ _id: run.datasetId }, { $set: set });
    }
    if (state === "succeeded") for (const rel of run.cleanup ?? []) await storage.remove(run.userId, rel).catch(() => {});
    const words = { succeeded: "Finished.", failed: error?.message ?? "Stopped with a problem.", cancelled: "Cancelled." };
    await addEvent(db, run, { kind: "state", message: words[state], data: { run: state } });
    return run;
  }

  /** A new version from a step's result (once: a rerun after a crash finds it there). */
  async function addVersion(run, step, result, madeBy) {
    const id = step.outputVersionId;
    if (await versions.findOne({ _id: id }, { projection: { _id: 1 } })) return false;
    const now = new Date();
    const path = step.params.output;
    const manifest = (await storage.readJson(run.userId, `${path}/manifest.json`)) ?? {};
    const contentHash = createHash("sha256").update((manifest.files ?? []).map((f) => `${f.path}:${f.sha256}`).join("\n")).digest("hex");
    const ds = await datasets.findOneAndUpdate({ _id: run.datasetId }, { $inc: { versionCount: 1 } }, { returnDocument: "after" });
    await versions.insertOne({
      _id: id,
      userId: run.userId,
      datasetId: run.datasetId,
      number: ds.versionCount,
      parentVersionId: step.inputVersionId ?? run.inputVersionId ?? null,
      madeBy: { runId: run._id, ...madeBy },
      contentHash,
      path,
      rows: result.rows,
      bytes: result.bytes ?? null,
      modality: result.modality,
      task: result.task,
      schema: result.schema ?? [],
      splits: result.splits ?? null,
      labels: result.labels ?? null,
      changes: result.changes ?? null,
      profileSummary: null,
      quality: null,
      exports: {},
      licences: manifest.licences ?? [],
      frozen: false,
      createdAt: now,
    });
    await datasets.updateOne(
      { _id: run.datasetId },
      { $set: { headVersionId: id, modality: ds.modality ?? result.modality, task: ds.task ?? result.task, rows: result.rows, updatedAt: now } },
    );
    return ds;
  }

  /** The step's result into the database: a new version, a profile, a quality check or an export. */
  async function applyResult(run, step, result) {
    if (step.op === "ingest") {
      const ds = await addVersion(run, step, result, { op: "ingest", sourceIds: [] });
      if (ds) {
        await versions.updateOne({ _id: step.outputVersionId }, { $set: { "madeBy.sourceIds": ds.sourceIds ?? [] } });
        if (ds.sourceIds?.length) await db.collection("sources").updateMany({ _id: { $in: ds.sourceIds } }, { $inc: { uses: 1 } });
      }
    } else if (step.outputVersionId) {
      const { input: _i, output: _o, ...settings } = step.params;
      await addVersion(run, step, result, { op: step.op, params: settings });
    } else if (step.op === "profile") {
      await versions.updateOne({ _id: step.profiles }, { $set: { profileSummary: result } });
    } else if (step.op === "validate") {
      await versions.updateOne({ _id: step.reports }, { $set: { quality: { score: result.score, verdict: result.verdict, passed: result.passed, total: result.total, gates: result.gates } } });
    } else if (step.op === "export") {
      await versions.updateOne({ _id: step.exports }, { $set: { [`exports.${step.format}`]: { path: result.path, bytes: result.bytes, splits: result.splits ?? null, at: new Date() } } });
    }
  }

  async function advance(job, { signal }) {
    let run = await runsCol.findOne({ _id: job.runId });
    if (!run || FINAL.includes(run.state)) return { kind: "done" };
    if (run.cancelRequested) {
      await finish(run, "cancelled");
      return { kind: "done" };
    }
    if (run.state !== "running") {
      run = await updateRun(db, run, { state: "running", startedAt: run.startedAt ?? new Date() });
      await addEvent(db, run, { kind: "state", message: "Started.", data: { run: "running" } });
    }
    const i = run.currentStep;
    if (i >= run.steps.length) {
      await finish(run, "succeeded");
      return { kind: "done" };
    }

    const step = run.steps[i];
    const label = STEP_LABEL[step.op] ?? step.op;
    const again = Boolean(step.startedAt);
    run = await updateRun(db, run, { [`steps.${i}.state`]: "running", [`steps.${i}.startedAt`]: new Date(), [`steps.${i}.error`]: null, [`steps.${i}.progress`]: null });
    await addEvent(db, run, { kind: "state", stepIndex: i, message: again ? `${label}: trying again.` : `${label}: started.`, data: { step: "running" } });
    await storage.ensureUser(run.userId);

    // Cancel: checked every few seconds while the step runs
    const cancel = new AbortController();
    const watch = setInterval(async () => {
      const r = await runsCol.findOne({ _id: run._id }, { projection: { cancelRequested: 1 } }).catch(() => null);
      if (r?.cancelRequested) cancel.abort(new Error("cancelled"));
    }, 3_000);

    let result = null;
    let failure = null;
    let lastStderr = null;
    let logs = 0;
    let lastProgress = 0;
    const metrics = {};
    let chain = Promise.resolve();
    const later = (fn) => (chain = chain.then(fn).catch((err) => log.warn({ err }, "could not record a step line")));

    const onLine = (m) => {
      if (m.kind === "result") result = m;
      else if (m.kind === "error") failure = { code: m.code ?? "STEP_FAILED", message: m.message ?? "The step stopped with a problem." };
      else if (m.kind === "metric") {
        metrics[m.name] = m.value;
        later(() => runsCol.updateOne({ _id: run._id }, { $set: { [`steps.${i}.metrics.${m.name}`]: m.value } }));
      } else if (m.kind === "progress") {
        const now = Date.now();
        if (now - lastProgress < PROGRESS_EVERY_MS) return;
        lastProgress = now;
        const progress = { done: m.done ?? 0, total: m.total ?? null, unit: m.unit ?? null };
        later(async () => {
          await runsCol.updateOne({ _id: run._id }, { $set: { [`steps.${i}.progress`]: progress } });
          await addEvent(db, run, { kind: "progress", stepIndex: i, data: progress });
        });
      } else if (m.kind === "log" || m.kind === "stderr") {
        if (m.kind === "stderr") lastStderr = m.message;
        if (logs++ < MAX_LOG_EVENTS) later(() => addEvent(db, run, { kind: m.kind === "log" ? "log" : "warning", stepIndex: i, message: String(m.message ?? "").slice(0, 2000) }));
      }
    };

    let exitCode;
    try {
      exitCode = await runner.run(
        {
          name: `cdata-${run._id}-${i}-${job.fencingToken}`,
          step: `${run._id}-${i}`,
          userId: run.userId,
          op: step.op,
          params: step.params,
          network: step.op === "fetch",
          timeoutSec: TIMEOUT_SEC[step.op] ?? DEFAULT_TIMEOUT_SEC,
        },
        onLine,
        AbortSignal.any([signal, cancel.signal]),
      );
    } catch (err) {
      if (cancel.signal.aborted && !signal.aborted) {
        await chain;
        run = await runsCol.findOne({ _id: run._id });
        run = await updateRun(db, run, { [`steps.${i}.state`]: "cancelled", [`steps.${i}.endedAt`]: new Date() });
        await finish(run, "cancelled");
        return { kind: "done" };
      }
      throw err;
    } finally {
      clearInterval(watch);
    }
    await chain;
    if (signal.aborted) return { kind: "done" }; // lost the lease: the new holder writes

    run = await runsCol.findOne({ _id: run._id });
    const now = new Date();
    if (exitCode === 0 && result) {
      const { kind: _k, ...data } = result;
      await applyResult(run, step, data);
      run = await updateRun(db, run, {
        [`steps.${i}.state`]: "succeeded",
        [`steps.${i}.endedAt`]: now,
        [`steps.${i}.metrics`]: { ...run.steps[i].metrics, ...metrics },
        [`steps.${i}.result`]: summarise(step.op, data),
        currentStep: i + 1,
      });
      await addEvent(db, run, { kind: "state", stepIndex: i, message: `${label}: done.`, data: { step: "succeeded", result: summarise(step.op, data) } });
      return { kind: "wait", delayMs: 0 };
    }

    const error = failure ?? { code: exitCode === 2 ? "BAD_PARAMS" : "STEP_FAILED", message: lastStderr ? `${label} stopped: ${lastStderr}` : `${label} stopped with a problem (exit code ${exitCode}).` };
    run = await updateRun(db, run, { [`steps.${i}.state`]: "failed", [`steps.${i}.endedAt`]: now, [`steps.${i}.error`]: error });
    await finish(run, "failed", { ...error, stepIndex: i });
    return { kind: "done" };
  }

  /** Hourly tidy-up: runs whose job died are marked failed, so the UI never waits forever. */
  async function gc() {
    const dead = await db.collection("jobs").find({ type: "run.advance", status: { $in: ["dead", "failed"] }, finishedAt: { $gt: new Date(Date.now() - 7 * 864e5) } }).toArray();
    for (const j of dead) {
      const run = await runsCol.findOne({ _id: j.runId, state: { $nin: FINAL } });
      if (run) await finish(run, "failed", { code: j.lastError?.code ?? "JOB_FAILED", message: j.lastError?.message ?? "The run stopped unexpectedly." }).catch(() => {});
    }
    return { kind: "done" };
  }

  return { "run.advance": advance, gc };
}

/** What a step's card shows, small enough to keep on the run. */
function summarise(op, r) {
  if (op === "fetch") return { files: r.files?.length ?? 0, bytes: r.bytes ?? 0 };
  if (op === "ingest") return { rows: r.rows, modality: r.modality, task: r.task, labels: r.labels?.length ?? 0, splits: r.splits };
  if (op === "profile") return { rows: r.rows, findings: r.findings?.length ?? 0, duplicates: r.duplicates?.exact ?? 0 };
  if (op === "validate") return { score: r.score, verdict: r.verdict, passed: r.passed, total: r.total };
  if (op === "export") return { bytes: r.bytes, format: r.format };
  if (r.changes) return { rows: r.rows, removed: r.changes.removed ?? 0, changed: r.changes.changed ?? 0, splits: r.splits ?? null, notes: (r.changes.notes ?? []).slice(0, 6) };
  return {};
}
