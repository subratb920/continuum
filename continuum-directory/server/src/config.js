/**
 * continuum-directory's settings. The host (continuum-api today) reads them
 * from its environment and passes them in, so the directory never reads
 * process.env itself and can move to a server of its own later.
 */
export function directoryConfigFromEnv(env = process.env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    databaseUrl: env.DIRECTORY_DATABASE_URL || "",
    // In the cloud the database is in the same cluster: no TLS unless asked
    ssl: env.DIRECTORY_DATABASE_SSL === "true",
    poolSize: n(env.DIRECTORY_POOL_SIZE, 10),
    // Sign-ins, app use and page views are kept this many days
    historyDays: n(env.LOGIN_HISTORY_DAYS, 180),
    // Salts the day-scoped hash that de-dups visitors (set it so it's stable across API copies)
    hashSecret: env.DIRECTORY_HASH_SECRET || "",
    // A user's access is cached this long per API copy
    accessCacheMs: n(env.DIRECTORY_ACCESS_CACHE_MS, 60_000),
  };
}

/** What's missing for the directory to start (empty when ready). */
export function configProblems(cfg) {
  return cfg.databaseUrl ? [] : ["DIRECTORY_DATABASE_URL"];
}
