import { ObjectId } from "mongodb";
import { conflict } from "./errors.js";

/**
 * Runs (spec 2.7, 5.1): a run takes one version (or a source) through steps
 * in order. Every state change is one versioned write plus an event, and each
 * step's output version id is chosen when the run is made, so a step that is
 * rerun after a crash still writes exactly one version.
 */
export const FINAL = ["succeeded", "failed", "cancelled"];

const runs = (db) => db.collection("runs");
const events = (db) => db.collection("run_events");

export const versionPath = (datasetId, versionId) => `datasets/${datasetId}/${versionId}`;

/** A build run: download (unless uploaded), turn into a dataset, measure it. */
export function buildSteps({ runId, datasetId, versionId, source, plan, uploadId, options = {}, maxBytes }) {
  const output = versionPath(datasetId, versionId);
  const input = uploadId ? `uploads/${uploadId}` : `raw/${runId}`;
  const steps = [];
  if (!uploadId) steps.push({ op: "fetch", params: { output: input, files: plan.files.map(({ url, path, bytes }) => ({ url, path, bytes, sha256: null })), maxBytes, headers: {} } });
  steps.push({
    op: "ingest",
    params: {
      input,
      output,
      sourceId: String(source._id),
      licence: source.licence ?? "unknown",
      modality: options.modality ?? null,
      task: options.task ?? null,
      textColumn: options.textColumn ?? null,
      labelColumn: options.labelColumn ?? plan?.labelColumn ?? null,
      labelNames: plan?.labelNames ?? null,
      maxRows: options.maxRows ?? null,
      keepSplits: true,
    },
    outputVersionId: versionId,
  });
  steps.push({ op: "profile", params: { input: output, sampleRows: 100_000 }, profiles: versionId });
  return steps.map((s) => ({ ...s, state: "pending", metrics: {}, progress: null, result: null, error: null, startedAt: null, endedAt: null }));
}

export async function createRun(db, { runId = new ObjectId(), userId, datasetId, inputVersionId = null, kind, steps, cleanup = [] }, now = new Date()) {
  const doc = {
    _id: runId,
    userId,
    datasetId,
    inputVersionId,
    kind,
    state: "queued",
    steps,
    currentStep: 0,
    cleanup,
    cancelRequested: false,
    eventSeq: 0,
    version: 1,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
  };
  await runs(db).insertOne(doc);
  return doc;
}

/** One versioned write: fails with a conflict when the run changed since it was read. */
export async function updateRun(db, run, set, now = new Date()) {
  const res = await runs(db).findOneAndUpdate(
    { _id: run._id, version: run.version },
    { $set: { ...set, updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!res) throw conflict("The run changed meanwhile.", "VERSION_CONFLICT");
  return res;
}

/** Adds a run event with the run's next sequence number. */
export async function addEvent(db, run, { kind, stepIndex = null, message = "", data = null }, now = new Date()) {
  const r = await runs(db).findOneAndUpdate({ _id: run._id }, { $inc: { eventSeq: 1 } }, { returnDocument: "after", projection: { eventSeq: 1 } });
  await events(db).insertOne({ runId: run._id, userId: run.userId, datasetId: run.datasetId, seq: r.eventSeq, at: now, kind, stepIndex, message, data });
}

export function runView(r) {
  return {
    id: String(r._id),
    datasetId: String(r.datasetId),
    kind: r.kind,
    state: r.state,
    currentStep: r.currentStep,
    cancelRequested: r.cancelRequested,
    error: r.error,
    steps: r.steps.map((s) => ({
      op: s.op,
      state: s.state,
      metrics: s.metrics ?? {},
      progress: s.progress ?? null,
      error: s.error ?? null,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      outputVersionId: s.outputVersionId ? String(s.outputVersionId) : null,
    })),
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

export function eventView(e) {
  return { id: String(e._id), runId: String(e.runId), datasetId: String(e.datasetId), seq: e.seq, at: e.at, kind: e.kind, stepIndex: e.stepIndex, message: e.message, data: e.data };
}
