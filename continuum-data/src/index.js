import os from "node:os";
import { randomBytes } from "node:crypto";
import { connectStore, ensureSchema } from "./store/db.js";
import { ensureRecurring } from "./store/queue.js";
import { ensureSeed } from "./catalogue/index.js";
import { huggingface } from "./catalogue/huggingface.js";
import { openml } from "./catalogue/openml.js";
import { uci } from "./catalogue/uci.js";
import { kaggle } from "./catalogue/kaggle.js";
import { urlConnector } from "./catalogue/url.js";
import { credentialStore } from "./credentials.js";
import { localStorage } from "./storage/local.js";
import { remoteStorage } from "./storage/remote.js";
import { proxyRunner } from "./runtime/proxyRunner.js";
import { inClusterKube } from "./runtime/kube.js";
import { kubeStore } from "./runtime/kubeStore.js";
import { kubeRunner } from "./runtime/kubeRunner.js";
import { JobRunner } from "./worker/runner.js";
import { dataHandlers } from "./worker/handlers.js";
import { createLive } from "./api/live.js";
import { createDataRouter } from "./api/router.js";
import { configProblems } from "./config.js";

export { dataConfigFromEnv } from "./config.js";

/**
 * continuum-data, Continuum's data engineering engine (spec Section 1).
 *
 * The host gives it its settings and a logger, mounts router({ auth }) at
 * /data, and calls start() and stop(). It brings its own database client,
 * storage and runner driver, and imports nothing from the host, so a later
 * server.js of its own can host it the same way (spec 1.5).
 */
/**
 * Where datasets live and how steps run: locally a folder and the Docker
 * runner proxy; in the cloud (DATA_RUNTIME=kubernetes) the data store pod on
 * a disk and a pod per step, both set up by the engine in its own namespace.
 */
function drivers(cfg, { log, fetchImpl, kube }) {
  if (cfg.runtime !== "kubernetes") {
    return { storage: localStorage(cfg.storePath), runner: proxyRunner({ url: cfg.runnerUrl, token: cfg.runnerToken, fetchImpl }) };
  }
  // The cluster is reached on first use, so a settings problem shows as "not ready", not a crash
  let k = kube;
  const cluster = () => (k ??= inClusterKube());
  let s = null;
  const store = {
    ensure: () => (s ??= kubeStore({ kube: cluster(), image: cfg.runnerImage, diskGb: cfg.storeDiskGb, log: log.child({ part: "data-store" }) })).ensure(),
    stale: () => s?.stale(),
  };
  let r = null;
  const runner = () => (r ??= kubeRunner({ kube: cluster(), store, image: cfg.runnerImage, cpu: cfg.runnerCpu, memory: cfg.runnerMemory, log }));
  return {
    store,
    storage: remoteStorage(() => store.ensure(), { fetchImpl, unreachable: () => store.stale() }),
    runner: { run: (...a) => runner().run(...a), remove: (name) => runner().remove(name) },
  };
}

export function createDataEngine(cfg, { log, fetchImpl = fetch, kube } = {}) {
  const { storage, runner, store } = drivers(cfg, { log, fetchImpl, kube });
  const engine = {
    cfg,
    log,
    ready: false,
    db: null,
    client: null,
    storage,
    runner,
    store: store ?? null,
    connectors: { huggingface: huggingface({ fetchImpl }), openml: openml({ fetchImpl }), uci: uci({ fetchImpl }), kaggle: kaggle({ fetchImpl }), url: urlConnector() },
    credentials: null,
    live: null,
    worker: null,

    router: ({ auth }) => createDataRouter({ engine, auth }),

    async start({ worker = true } = {}) {
      const missing = configProblems(cfg);
      if (missing.length) throw new Error(`continuum-data needs these settings: ${missing.join(", ")}`);
      const { client, db } = await connectStore(cfg.mongoUri, cfg.dbName);
      Object.assign(engine, { client, db, credentials: credentialStore(db, cfg.secretKey) });
      await ensureSchema(db);
      await ensureSeed(db);
      engine.live = createLive(db, log);
      engine.live.start();
      if (worker) {
        await ensureRecurring(db, "gc", 3600);
        engine.worker = new JobRunner({
          db,
          log: log.child({ part: "data-worker" }),
          workerId: `${os.hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`,
          handlers: dataHandlers({ db, storage: engine.storage, runner: engine.runner, credentials: engine.credentials, log }),
          concurrency: cfg.workerConcurrency,
        });
        engine.worker.start();
      }
      engine.ready = true;
      log.info({ db: cfg.dbName, runtime: cfg.runtime, store: cfg.runtime === "kubernetes" ? "data-store pod" : cfg.storePath, worker }, "continuum-data started");
      // In the cloud: the store is set up now, in the background (the first upload or step would wait for it)
      engine.store?.ensure().catch((err) => log.warn({ err }, "data store not ready yet; it is set up again on first use"));
    },

    async stop() {
      engine.ready = false;
      await engine.worker?.stop();
      await engine.live?.stop();
      await engine.client?.close();
    },
  };
  return engine;
}
