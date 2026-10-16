import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { ObjectId } from "mongodb";
import { createDataEngine } from "../src/index.js";

/**
 * A real MongoDB is needed (the queue's claim is a MongoDB pipeline update).
 * By default the local Continuum one (docker/docker-compose.yml); each test
 * file gets a database of its own, dropped at the end.
 */
export const MONGO_URI = process.env.TEST_MONGO_URI || "mongodb://continuum_admin:continuum_dev_pw@localhost:45171/?authSource=admin&directConnection=true";

export const quietLog = { info() {}, warn() {}, error() {}, debug() {}, child() { return quietLog; } };

/** A runner that plays the steps without Docker: writes the files the real ops would. */
export function fakeRunner(store, behaviour = {}) {
  const calls = [];
  return {
    calls,
    async run(spec, onLine, signal) {
      calls.push(spec);
      const hook = behaviour[spec.op];
      if (hook) {
        const r = await hook(spec, onLine, signal, calls);
        if (r !== undefined) return r;
      }
      const root = path.join(store, String(spec.userId));
      const p = spec.params;
      if (spec.op === "fetch") {
        await mkdir(path.join(root, p.output, "train"), { recursive: true });
        await writeFile(path.join(root, p.output, "train", "0000.parquet"), "x");
        onLine({ kind: "progress", done: 1, total: 1, unit: "files" });
        onLine({ kind: "result", files: [{ path: "train/0000.parquet", bytes: 1 }], bytes: 1 });
      } else if (spec.op === "ingest") {
        await mkdir(path.join(root, p.output, "data"), { recursive: true });
        await writeFile(path.join(root, p.output, "manifest.json"), JSON.stringify({ files: [{ path: "data/part-00000.parquet", sha256: "abc", bytes: 1 }], licences: [{ spdx: p.licence, rows: 3 }] }));
        onLine({ kind: "log", message: "Read 3 rows." });
        onLine({ kind: "result", rows: 3, bytes: 10, modality: "text", task: "classify", schema: [{ name: "text", type: "string", role: "input" }], labels: ["neg", "pos"], splits: { train: 3 } });
      } else if (spec.op === "profile") {
        const profile = { rows: 3, sampled: 3, findings: [], duplicates: { exact: 0 } };
        await writeFile(path.join(root, p.input, "profile.json"), JSON.stringify(profile));
        onLine({ kind: "result", ...profile });
      }
      return 0;
    },
  };
}

export function fakeHub() {
  return {
    async search() {
      return [{ connector: "huggingface", ref: "someone/found-it", title: "Found it", description: "From a search", modalities: ["text"], tasks: ["classify"], licence: "mit", size: { rows: 100 }, tags: [], popularity: 5 }];
    },
    async describe(ref) {
      return { ref, configs: [{ name: "default", splits: [{ name: "train", rows: 3, bytes: 1, files: [] }] }], convertible: true, gated: false };
    },
    async fetchPlan() {
      return { files: [{ url: "https://example.test/0000.parquet", path: "train/0000.parquet", bytes: 1 }], bytes: 1, rows: 3, config: "default", splits: ["train"], labelColumn: "label", labelNames: ["neg", "pos"] };
    },
  };
}

/** An engine on a throwaway database and store, served on a random port. */
export async function startTestEngine({ name, behaviour, worker = true } = {}) {
  const store = await mkdtemp(path.join(tmpdir(), "cdata-test-"));
  const cfg = {
    enabled: true,
    mongoUri: MONGO_URI,
    dbName: `continuum_data_test_${name}_${process.pid}`,
    storePath: store,
    runnerUrl: "http://unused",
    runnerToken: "test",
    workerConcurrency: 2,
    limits: { diskBytes: 1024 ** 3, uploadBytes: 100 * 1024 ** 2, runsAtOnce: 2 },
  };
  const engine = createDataEngine(cfg, { log: quietLog });
  engine.runner = fakeRunner(store, behaviour);
  engine.connectors.huggingface = fakeHub();
  await engine.start({ worker: false });
  if (worker) startWorker(engine);

  const app = express();
  app.use(express.json());
  // Stand-in for continuum-api's requireAuth
  const auth = (req, res, next) => {
    const id = req.headers["x-test-user"];
    if (!id) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id };
    next();
  };
  app.use("/data", engine.router({ auth }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/data`;

  const api = (user) => async (method, p, body, headers = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { "x-test-user": user, ...(body !== undefined && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };

  return {
    engine,
    store,
    base,
    api,
    users: { a: String(new ObjectId()), b: String(new ObjectId()) },
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await engine.worker?.stop(1000);
      await engine.db.dropDatabase();
      await engine.stop();
      await rm(store, { recursive: true, force: true });
    },
  };
}

export async function startWorker(engine, opts = {}) {
  const { JobRunner } = await import("../src/worker/runner.js");
  const { dataHandlers } = await import("../src/worker/handlers.js");
  engine.worker = new JobRunner({
    db: engine.db,
    log: quietLog,
    workerId: opts.workerId ?? `test-${Math.random().toString(16).slice(2)}`,
    handlers: dataHandlers({ db: engine.db, storage: engine.storage, runner: engine.runner, log: quietLog }),
    concurrency: 2,
    pollMs: 50,
    idlePollMs: 100,
    leaseMs: opts.leaseMs ?? 60_000,
    heartbeatMs: opts.heartbeatMs ?? 20_000,
  });
  engine.worker.start();
  return engine.worker;
}

export async function waitFor(fn, { timeoutMs = 10_000, everyMs = 50 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
