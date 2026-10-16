import { DataError } from "../errors.js";

/** JSON from a source's public API, with plain errors (shared by the connectors). */
export async function getJson(fetchImpl, url, { what, name, headers = {}, timeoutMs = 20_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new DataError(502, "SOURCE_UNREACHABLE", `${name} isn't reachable right now (${e.name === "TimeoutError" ? "it didn't answer in time" : e.message}).`);
  }
  if (res.status === 404) throw new DataError(404, "NOT_FOUND", `${what} wasn't found on ${name}.`);
  if (res.status === 401 || res.status === 403) throw new DataError(403, "NEEDS_ACCESS", `${name} refused: check your ${name} token in Settings.`);
  if (!res.ok) throw new DataError(502, "SOURCE_ERROR", `${name} answered ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new DataError(502, "SOURCE_ERROR", `${name} sent something that isn't JSON.`);
  }
}

/** Licence names as sources write them, to the ids of catalogue/licences.js. */
export function licenceId(name) {
  const n = String(name ?? "").toLowerCase().trim();
  if (!n || n === "unknown" || n === "none") return "unknown";
  if (n.includes("cc0") || n.includes("public domain")) return "cc0-1.0";
  if (n.includes("by-nc-sa") || n.includes("by nc sa")) return "cc-by-nc-sa-4.0";
  if (n.includes("by-nc") || n.includes("by nc") || n.includes("noncommercial")) return "cc-by-nc-4.0";
  if (n.includes("by-sa") || n.includes("by sa") || n.includes("sharealike")) return n.includes("3.0") ? "cc-by-sa-3.0" : "cc-by-sa-4.0";
  if (n.includes("cc by") || n.includes("cc-by") || n.includes("attribution")) return n.includes("3.0") ? "cc-by-3.0" : "cc-by-4.0";
  if (n.includes("odbl") || n.includes("open database")) return "odbl";
  if (n.includes("apache")) return "apache-2.0";
  if (n === "mit" || n.includes("mit license")) return "mit";
  if (n.includes("bsd")) return "bsd-3-clause";
  if (n.includes("gpl") || n.includes("gnu")) return "gfdl";
  return "other";
}

const EXT = { ".csv": "tabular", ".tsv": "tabular", ".xlsx": "tabular", ".parquet": "tabular", ".json": "text", ".jsonl": "text", ".txt": "text", ".md": "text", ".pdf": "text", ".html": "text" };

export function guessModality(name) {
  const low = String(name).toLowerCase();
  const ext = Object.keys(EXT).find((e) => low.endsWith(e));
  return ext ? EXT[ext] : null;
}

export const isArchive = (name) => /\.(zip|tar|tar\.gz|tgz)$/i.test(String(name));
