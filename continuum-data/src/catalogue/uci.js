import { badRequest, DataError } from "../errors.js";
import { getJson } from "./http.js";

/**
 * The UCI Machine Learning Repository (spec 7.3): classic datasets, shared
 * under CC BY 4.0. Its API gives each dataset's CSV and target columns; a
 * dataset without a CSV comes as its zip.
 */
const API = "https://archive.ics.uci.edu/api";
const NAME = "the UCI repository";

export function uci({ fetchImpl = fetch } = {}) {
  const ref = (r) => {
    const id = String(r).trim();
    if (!/^\d{1,6}$/.test(id)) throw badRequest("A UCI dataset is a number, like 53.", "BAD_REF");
    return id;
  };
  return {
    id: "uci",
    async search({ q, limit = 20 }) {
      const r = await getJson(fetchImpl, `${API}/datasets/list?filter=python&search=${encodeURIComponent(q)}`, { what: `"${q}"`, name: NAME });
      return (r.data ?? []).slice(0, limit).map((d) => ({
        connector: "uci",
        ref: String(d.id),
        title: d.name,
        description: "A dataset from the UCI Machine Learning Repository.",
        modalities: ["tabular"],
        tasks: [],
        licence: "cc-by-4.0",
        size: {},
        tags: [],
        popularity: 0,
      }));
    },
    async describe(r) {
      const id = ref(r);
      const res = await getJson(fetchImpl, `${API}/dataset?id=${id}`, { what: `Dataset ${id}`, name: NAME });
      const d = res.data;
      if (!d) throw new DataError(404, "NOT_FOUND", `Dataset ${id} wasn't found on ${NAME}.`);
      const tasks = String(d.tasks ?? "").toLowerCase();
      return {
        connector: "uci",
        ref: id,
        title: d.name,
        description: String(d.abstract ?? "").slice(0, 400),
        modalities: ["tabular"],
        tasks: tasks.includes("regression") ? ["regress"] : tasks.includes("classification") ? ["classify"] : [],
        licence: "cc-by-4.0",
        size: { rows: d.num_instances ?? null },
        tags: [],
        popularity: 0,
        configs: [],
        convertible: Boolean(d.data_url || d.uci_id),
        dataUrl: d.data_url ?? null,
        target: Array.isArray(d.target_col) ? d.target_col[0] : d.target_col ?? null,
        slug: String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, "+"),
      };
    },
    async fetchPlan(r) {
      const d = await this.describe(r);
      const files = d.dataUrl
        ? [{ url: d.dataUrl, path: `${d.ref}.csv`, bytes: null }]
        : [{ url: `https://archive.ics.uci.edu/static/public/${d.ref}/${d.slug}.zip`, path: `${d.ref}.zip`, bytes: null }];
      return { files, bytes: 0, rows: d.size.rows ?? null, extract: !d.dataUrl, labelColumn: d.target, labelNames: null, source: d };
    },
  };
}
