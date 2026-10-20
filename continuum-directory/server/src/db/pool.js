import pg from "pg";
import { readdir, readFile } from "node:fs/promises";

// Counts come back as numbers (they're far below 2^53 here), dates as Dates
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1082, (v) => v); // date: "YYYY-MM-DD" as written

/** The directory's database connection pool. */
export function createPool(cfg) {
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.poolSize,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    application_name: "continuum-directory",
  });
  return pool;
}

/** Runs fn(client) in one transaction (all or nothing). */
export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The schema: each file in migrations/ once, in name order, each in its own
 * transaction; an advisory lock keeps two API copies from running them at once.
 */
export async function migrate(pool, log) {
  const dir = new URL("./migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(451930)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(new URL(f, dir), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        log?.info?.({ migration: f }, "Directory schema updated");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Directory migration ${f} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(451930)").catch(() => {});
    client.release();
  }
}
