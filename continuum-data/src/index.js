import os from "node:os";
import { randomBytes } from "node:crypto";
import { connectStore, ensureSchema } from "./store/db.js";
import { ensureRecurring } from "./store/queue.js";
import { ensureSeed } from "./catalogue/index.js";
import { huggingface } from "./catalogue/huggingface.js";
import { localStorage } from "./storage/local.js";
import { proxyRunner } from "./runtime/proxyRunner.js";
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
export function createDataEngine(cfg, { log, fetchImpl = fetch } = {}) {
  const engine = {
    cfg,
    log,
    ready: false,
    db: null,
    client: null,
    storage: localStorage(cfg.storePath),
    runner: proxyRunner({ url: cfg.runnerUrl, token: cfg.runnerToken, fetchImpl }),
    connectors: { huggingface: huggingface({ fetchImpl }) },
    live: null,
    worker: null,

    router: ({ auth }) => createDataRouter({ engine, auth }),

    async start({ worker = true } = {}) {
      const missing = configProblems(cfg);
      if (missing.length) throw new Error(`continuum-data needs these settings: ${missing.join(", ")}`);
      const { client, db } = await connectStore(cfg.mongoUri, cfg.dbName);
      Object.assign(engine, { client, db });
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
          handlers: dataHandlers({ db, storage: engine.storage, runner: engine.runner, log }),
          concurrency: cfg.workerConcurrency,
        });
        engine.worker.start();
      }
      engine.ready = true;
      log.info({ db: cfg.dbName, store: cfg.storePath, worker }, "continuum-data started");
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
