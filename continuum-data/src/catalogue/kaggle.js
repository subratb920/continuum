import { badRequest } from "../errors.js";
import { getJson, licenceId } from "./http.js";

/**
 * Kaggle (spec 7.3). Kaggle's API needs the user's own token (Settings), for
 * searching and for downloads; the token is passed as Basic auth and is
 * dropped by the runner if a download is redirected to another site.
 */
const API = "https://www.kaggle.com/api/v1";
const NAME = "Kaggle";

export const kaggleAuth = (token) => `Basic ${Buffer.from(token).toString("base64")}`;

export function kaggle({ fetchImpl = fetch } = {}) {
  const ref = (r) => {
    const v = String(r).trim().replace(/^https:\/\/www\.kaggle\.com\/datasets\//, "").replace(/\/+$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(v)) throw badRequest("A Kaggle dataset is owner/name, like heptapod/titanic.", "BAD_REF");
    return v;
  };
  const toSource = (d) => ({
    connector: "kaggle",
    ref: d.ref,
    title: d.title || d.ref,
    description: String(d.subtitle ?? "").slice(0, 400),
    modalities: ["tabular"],
    tasks: [],
    licence: licenceId(d.licenseName),
    size: { bytes: d.totalBytes ?? null },
    tags: (d.tags ?? []).map((t) => t.name ?? t).filter(Boolean).slice(0, 5),
    popularity: (d.downloadCount ?? 0) + 20 * (d.voteCount ?? 0),
  });
  return {
    id: "kaggle",
    needsCredential: "kaggle",
    async search({ q, limit = 20, token }) {
      if (!token) return [];
      const list = await getJson(fetchImpl, `${API}/datasets/list?search=${encodeURIComponent(q)}&page=1`, { what: `"${q}"`, name: NAME, headers: { Authorization: kaggleAuth(token) } });
      return (Array.isArray(list) ? list : []).slice(0, limit).map(toSource);
    },
    async describe(r, { token } = {}) {
      const id = ref(r);
      const [owner, slug] = id.split("/");
      if (!token) return { ...toSource({ ref: id, title: slug.replace(/[_-]+/g, " ") }), configs: [], convertible: true, needsCredential: "kaggle" };
      const d = await getJson(fetchImpl, `${API}/datasets/view/${owner}/${slug}`, { what: id, name: NAME, headers: { Authorization: kaggleAuth(token) } });
      return { ...toSource({ ...d, ref: id }), configs: [], convertible: true, needsCredential: "kaggle" };
    },
    async fetchPlan(r) {
      const id = ref(r);
      return {
        files: [{ url: `${API}/datasets/download/${id}`, path: `${id.replace("/", "__")}.zip`, bytes: null }],
        bytes: 0,
        rows: null,
        extract: true,
        credential: "kaggle",
        labelColumn: null,
        labelNames: null,
      };
    },
  };
}
