/**
 * continuum-data's settings (spec 1.6). The host app (continuum-api today)
 * reads them from its environment and passes them in, so the module never
 * reads process.env itself and can move to its own server later.
 */
const GB = 1024 ** 3;

export function dataConfigFromEnv(env = process.env) {
  const enabled = env.DATA_ENABLED === "true";
  return {
    enabled,
    mongoUri: env.DATA_MONGO_URI || env.MONGO_URI || "",
    dbName: env.DATA_DB_NAME || "continuum_data",
    storePath: env.DATA_STORE_PATH || "/store",
    runnerUrl: env.DATA_RUNNER_URL || "http://continuum-data-runner-proxy:45191",
    runnerToken: env.DATA_RUNNER_TOKEN || "",
    // "docker" (the runner proxy, local) or "kubernetes" (in the cloud: steps
    // as pods, the store as a pod on a disk, set up by the engine itself)
    runtime: env.DATA_RUNTIME === "kubernetes" ? "kubernetes" : "docker",
    runnerImage: env.DATA_RUNNER_IMAGE || "",
    storeDiskGb: Number(env.DATA_STORE_DISK_GB || 50),
    runnerCpu: env.DATA_RUNNER_CPU || "1",
    runnerMemory: env.DATA_RUNNER_MEMORY || "4Gi",
    workerConcurrency: Number(env.DATA_WORKER_CONCURRENCY || 2),
    secretKey: env.DATA_SECRET_KEY || "",
    limits: {
      diskBytes: Number(env.DATA_DISK_GB || 20) * GB,
      uploadBytes: Number(env.DATA_UPLOAD_GB || 5) * GB,
      runsAtOnce: Number(env.DATA_RUNS_AT_ONCE || 2),
    },
  };
}

/** What's missing for the engine to start (empty when ready). */
export function configProblems(cfg) {
  const missing = [];
  if (!cfg.mongoUri) missing.push("DATA_MONGO_URI or MONGO_URI");
  if (cfg.runtime === "kubernetes") {
    if (!cfg.runnerImage) missing.push("DATA_RUNNER_IMAGE");
  } else if (!cfg.runnerToken) missing.push("DATA_RUNNER_TOKEN");
  return missing;
}
