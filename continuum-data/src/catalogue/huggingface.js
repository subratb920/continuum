import { badRequest, DataError } from "../errors.js";

/**
 * Hugging Face Hub connector (spec 7.2, 7.3). Node only reads metadata
 * (search, the dataset's page, its Parquet file list); the runner's fetch op
 * downloads the files.
 */
const HUB = "https://huggingface.co";
const SERVER = "https://datasets-server.huggingface.co";
const MODALITIES = ["text", "tabular", "image", "audio"];
const TASKS = {
  "text-classification": "classify",
  "token-classification": "classify",
  "tabular-classification": "classify",
  "image-classification": "classify",
  "audio-classification": "classify",
  "zero-shot-classification": "classify",
  "tabular-regression": "regress",
  "object-detection": "detect",
  "automatic-speech-recognition": "transcribe",
  "question-answering": "chat",
  "text-generation": "generate",
  "text2text-generation": "chat",
  summarization: "chat",
  translation: "chat",
};

const ROWS = { "n<1K": 1_000, "1K<n<10K": 10_000, "10K<n<100K": 100_000, "100K<n<1M": 1_000_000, "1M<n<10M": 10_000_000 };

async function getJson(fetchImpl, url, what) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new DataError(502, "SOURCE_UNREACHABLE", `Hugging Face isn't reachable right now (${e.message}).`);
  }
  if (res.status === 404) throw new DataError(404, "NOT_FOUND", `${what} wasn't found on Hugging Face.`);
  if (res.status === 401 || res.status === 403) throw new DataError(403, "NEEDS_ACCESS", `${what} needs a Hugging Face account with access to it.`);
  if (!res.ok) throw new DataError(502, "SOURCE_ERROR", `Hugging Face answered ${res.status}.`);
  return res.json();
}

/** A Hub dataset (list or page) as a catalogue source. */
export function toSource(d) {
  const tags = d.tags ?? [];
  const tagged = (prefix) => tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  const modalities = tagged("modality:").filter((m) => MODALITIES.includes(m));
  const tasks = [...new Set(tagged("task_categories:").map((t) => TASKS[t]).filter(Boolean))];
  const licence = tagged("license:")[0] ?? (Array.isArray(d.cardData?.license) ? d.cardData.license[0] : d.cardData?.license) ?? "unknown";
  const sizeTag = tagged("size_categories:")[0];
  const description = String(d.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  return {
    connector: "huggingface",
    ref: d.id,
    title: d.cardData?.pretty_name || d.id.split("/").pop().replace(/[_-]+/g, " "),
    description,
    modalities: modalities.length ? (modalities.includes("tabular") && modalities.includes("text") ? ["tabular", "text"] : modalities) : ["text"],
    tasks,
    licence: String(licence).toLowerCase(),
    size: { rows: sizeTag ? ROWS[sizeTag] ?? null : null, approx: Boolean(sizeTag) },
    tags: tagged("language:").slice(0, 5),
    popularity: (d.downloads ?? 0) + 50 * (d.likes ?? 0),
    gated: Boolean(d.gated),
    adult: tags.includes("not-for-all-audiences"),
  };
}

export function huggingface({ fetchImpl = fetch } = {}) {
  return {
    id: "huggingface",

    async search({ q, modality, limit = 20 }) {
      const params = new URLSearchParams({ search: q, limit: String(limit), full: "true", sort: "downloads" });
      if (modality) params.set("filter", `modality:${modality}`);
      const list = await getJson(fetchImpl, `${HUB}/api/datasets?${params}`, "That search");
      return list.filter((d) => !d.private && !d.disabled).map(toSource);
    },

    /** The dataset's page plus what the Parquet copy holds: subsets, splits, label names. */
    async describe(ref) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(ref)) throw badRequest("That isn't a Hugging Face dataset name (owner/name).");
      const page = await getJson(fetchImpl, `${HUB}/api/datasets/${ref}`, ref);
      const source = toSource(page);
      const [parquet, info] = await Promise.all([
        getJson(fetchImpl, `${SERVER}/parquet?dataset=${encodeURIComponent(ref)}`, ref).catch(() => null),
        getJson(fetchImpl, `${SERVER}/info?dataset=${encodeURIComponent(ref)}`, ref).catch(() => null),
      ]);
      const configs = {};
      for (const f of parquet?.parquet_files ?? []) {
        const c = (configs[f.config] ??= { name: f.config, splits: {} });
        const s = (c.splits[f.split] ??= { name: f.split, bytes: 0, files: [] });
        s.bytes += f.size ?? 0;
        s.files.push({ url: f.url, bytes: f.size ?? null });
      }
      for (const [name, ci] of Object.entries(info?.dataset_info ?? {})) {
        const c = (configs[name] ??= { name, splits: {} });
        for (const [split, si] of Object.entries(ci.splits ?? {})) if (c.splits[split]) c.splits[split].rows = si.num_examples ?? null;
        const features = ci.features ?? {};
        const classLabel = Object.entries(features).find(([, f]) => f?._type === "ClassLabel");
        if (classLabel) {
          c.labelColumn = classLabel[0];
          c.labelNames = classLabel[1].names ?? null;
        }
        c.columns = Object.keys(features);
      }
      return {
        ...source,
        configs: Object.values(configs).map((c) => ({ ...c, splits: Object.values(c.splits) })),
        convertible: Boolean(parquet?.parquet_files?.length),
      };
    },

    /** What the fetch op downloads: one subset, one split or all of them. */
    async fetchPlan(ref, { config, split } = {}) {
      const d = await this.describe(ref);
      if (d.gated) throw new DataError(403, "NEEDS_ACCESS", "This dataset asks you to accept its terms on Hugging Face first. Signing in to Hugging Face from Continuum comes in a later update.");
      if (!d.convertible || !d.configs.length) throw new DataError(422, "NOT_CONVERTIBLE", "Hugging Face hasn't made a ready-to-use copy of this dataset, so it can't be downloaded yet.");
      const c = d.configs.find((x) => x.name === config) ?? d.configs.find((x) => x.name === "default") ?? d.configs[0];
      const splits = split === "all" ? c.splits : c.splits.filter((s) => s.name === (split || (c.splits.some((x) => x.name === "train") ? "train" : c.splits[0]?.name)));
      if (!splits.length) throw badRequest(`The subset ${c.name} has no split called ${split}.`);
      const files = splits.flatMap((s) => s.files.map((f, i) => ({ url: f.url, path: `${s.name}/${String(i).padStart(4, "0")}.parquet`, bytes: f.bytes })));
      return {
        files,
        bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
        rows: splits.reduce((n, s) => n + (s.rows ?? 0), 0) || null,
        config: c.name,
        splits: splits.map((s) => s.name),
        labelColumn: c.labelColumn ?? null,
        labelNames: c.labelNames ?? null,
        source: d,
      };
    },
  };
}
