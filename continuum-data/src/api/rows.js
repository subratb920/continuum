import { cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects } from "hyparquet";

/**
 * Rows for the data viewer, read straight from a version's Parquet files
 * (spec 6: at most 200 per call). Versions never change, so each file's row
 * count is cached.
 */
const counts = new Map();
const MAX_CELL = 20_000;

/**
 * The version's Parquet files: open(rel) gives one as an AsyncBuffer (from the
 * storage driver: a local file, or byte ranges from the data store); key names
 * the version (user and path) for the row-count cache.
 */
async function partsOf({ open, key }, manifest) {
  const files = (manifest?.files ?? []).map((f) => f.path).filter((p) => p.startsWith("data/") && p.endsWith(".parquet")).sort();
  const parts = [];
  for (const rel of files) {
    const id = `${key}/${rel}`;
    const file = () => open(rel).then((b) => cachedAsyncBuffer(b));
    let rows = counts.get(id);
    if (rows === undefined) {
      const meta = await parquetMetadataAsync(await file());
      rows = Number(meta.num_rows);
      counts.set(id, rows);
    }
    parts.push({ file, rows });
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

/** Rows of one split only: reads the _split column first, then just the matching rows. */
async function readSplitRows(parts, split, offset, limit) {
  const rows = [];
  let seen = 0;
  for (const p of parts) {
    const file = await p.file();
    const col = await parquetReadObjects({ file, columns: ["_split"] });
    const hits = [];
    col.forEach((r, i) => r._split === split && hits.push(i));
    // The page's rows from this file, read as one span and picked out
    const wanted = hits.slice(Math.max(0, offset - seen), Math.max(0, offset - seen) + (limit - rows.length));
    seen += hits.length;
    if (!wanted.length) continue;
    const span = await parquetReadObjects({ file, rowStart: wanted[0], rowEnd: wanted[wanted.length - 1] + 1 });
    for (const i of wanted) rows.push(plain(span[i - wanted[0]]));
  }
  return { total: seen, offset, rows };
}

export async function readRows(version, manifest, offset, limit, { split = null } = {}) {
  const parts = await partsOf(version, manifest);
  if (split) return readSplitRows(parts, split, offset, limit);
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
    const got = await parquetReadObjects({ file: await p.file(), rowStart: start, rowEnd: end });
    rows.push(...got.map(plain));
    start = 0;
  }
  return { total, offset, rows };
}
