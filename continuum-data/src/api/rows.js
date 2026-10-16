import path from "node:path";
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from "hyparquet";

/**
 * Rows for the data viewer, read straight from a version's Parquet files
 * (spec 6: at most 200 per call). Versions never change, so each file's row
 * count is cached.
 */
const counts = new Map();
const MAX_CELL = 20_000;

async function partsOf(dir, manifest) {
  const files = (manifest?.files ?? []).map((f) => f.path).filter((p) => p.startsWith("data/") && p.endsWith(".parquet")).sort();
  const parts = [];
  for (const rel of files) {
    const full = path.join(dir, rel);
    let rows = counts.get(full);
    if (rows === undefined) {
      const meta = await parquetMetadataAsync(await asyncBufferFromFile(full));
      rows = Number(meta.num_rows);
      counts.set(full, rows);
    }
    parts.push({ full, rows });
  }
  return parts;
}

/** Makes a row JSON-safe: BigInt as numbers, bytes left out, long text cut. */
export function plain(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}…` : value;
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

export async function readRows(dir, manifest, offset, limit) {
  const parts = await partsOf(dir, manifest);
  const total = parts.reduce((n, p) => n + p.rows, 0);
  const rows = [];
  let start = offset;
  for (const p of parts) {
    if (rows.length >= limit) break;
    if (start >= p.rows) {
      start -= p.rows;
      continue;
    }
    const end = Math.min(p.rows, start + (limit - rows.length));
    const got = await parquetReadObjects({ file: await asyncBufferFromFile(p.full), rowStart: start, rowEnd: end });
    rows.push(...got.map(plain));
    start = 0;
  }
  return { total, offset, rows };
}
