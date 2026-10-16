import { badRequest } from "../errors.js";
import { getJson, licenceId } from "./http.js";

/**
 * OpenML (spec 7.3): open tables for machine learning, each with its
 * prediction target. API v1 (JSON); the data comes as Parquet when OpenML has
 * a copy, otherwise as CSV.
 */
const API = "https://www.openml.org/api/v1/json";
const NAME = "OpenML";

const quality = (d, q) => Number(d.quality?.find?.((x) => x.name === q)?.value ?? NaN);

export function openml({ fetchImpl = fetch } = {}) {
  const ref = (r) => {
    const id = String(r).trim();
    if (!/^\d{1,9}$/.test(id)) throw badRequest("An OpenML dataset is a number, like 61.", "BAD_REF");
    return id;
  };
  return {
    id: "openml",
    async search({ q, modality, limit = 20 }) {
      if (modality && modality !== "tabular") return [];
      const name = String(q).trim().toLowerCase().replace(/[^\w-]+/g, "-");
      if (!name) return [];
      const r = await getJson(fetchImpl, `${API}/data/list/data_name/${encodeURIComponent(name)}/limit/${limit}/status/active`, { what: `"${q}"`, name: NAME }).catch((e) => (e.code === "NOT_FOUND" ? { data: { dataset: [] } } : Promise.reject(e)));
      const seen = new Set();
      return (r.data?.dataset ?? [])
        .filter((d) => !seen.has(d.name) && seen.add(d.name))
        .map((d) => ({
          connector: "openml",
          ref: String(d.did),
          title: d.name.replace(/[_-]+/g, " "),
          description: `An OpenML table (version ${d.version}).`,
          modalities: ["tabular"],
          tasks: ["classify"],
          licence: "unknown",
          size: { rows: Number.isFinite(quality(d, "NumberOfInstances")) ? quality(d, "NumberOfInstances") : null },
          tags: [],
          popularity: 0,
        }));
    },
    async describe(r) {
      const id = ref(r);
      const d = (await getJson(fetchImpl, `${API}/data/${id}`, { what: `Dataset ${id}`, name: NAME })).data_set_description;
      return {
        connector: "openml",
        ref: id,
        title: String(d.name).replace(/[_-]+/g, " "),
        description: String(d.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
        modalities: ["tabular"],
        tasks: d.default_target_attribute ? ["classify"] : [],
        licence: licenceId(d.licence),
        size: {},
        tags: (d.tag ?? []).slice?.(0, 5) ?? [],
        popularity: 0,
        configs: [],
        convertible: Boolean(d.parquet_url || d.file_id),
        target: d.default_target_attribute ?? null,
        parquetUrl: d.parquet_url ?? null,
        fileId: d.file_id ?? null,
        name: d.name,
      };
    },
    async fetchPlan(r) {
      const d = await this.describe(r);
      const file = d.parquetUrl
        ? { url: d.parquetUrl.replace(/^http:/, "https:"), path: `${d.name}.parquet` }
        : { url: `https://www.openml.org/data/get_csv/${d.fileId}/${encodeURIComponent(d.name)}.csv`, path: `${d.name}.csv` };
      return { files: [{ ...file, path: file.path.replace(/[^\w.-]+/g, "_"), bytes: null }], bytes: 0, rows: null, extract: false, labelColumn: d.target?.split(",")[0] ?? null, labelNames: null, source: d };
    },
  };
}
