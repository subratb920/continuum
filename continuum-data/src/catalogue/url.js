import { badRequest } from "../errors.js";
import { guessModality, isArchive } from "./http.js";

/**
 * Any web link to a data file or an archive (spec 7.3). Continuum doesn't
 * open it from Node: the runner downloads it (and unpacks archives).
 */
const SUPPORTED = /\.(csv|tsv|json|jsonl|ndjson|parquet|xlsx|txt|md|html?|pdf|zip|tar|tar\.gz|tgz)$/i;

/** A readable name: the file's, or (for main.zip, master.zip, download.zip…) the folder's. */
function titleFor(url, file) {
  const plain = (x) => decodeURIComponent(x).replace(/\.(zip|tar\.gz|tgz|tar|csv|tsv|jsonl?|ndjson|parquet|xlsx|txt|md|html?|pdf)$/i, "").replace(/[_-]+/g, " ").trim();
  const name = plain(file);
  if (name && !/^(main|master|archive|download|data|dataset|file|export)$/i.test(name)) return name;
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  // GitHub archives: /owner/repo/archive/…
  const gh = parts.indexOf("archive");
  if (new URL(url).hostname.endsWith("github.com") && gh >= 2) return plain(parts[gh - 1]);
  const folder = parts.slice(0, -1).reverse().find((p) => !/^(refs|heads|tags|archive|download|files|raw|blob|main|master)$/i.test(p));
  return folder ? plain(folder) : name || "Linked file";
}

export function urlConnector() {
  function parse(ref) {
    let u;
    try {
      u = new URL(String(ref).trim());
    } catch {
      throw badRequest("That isn't a web address.", "BAD_URL");
    }
    if (u.protocol !== "https:") throw badRequest("Only https:// links can be used.", "BAD_URL");
    if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(u.hostname) || /^(10|127|169\.254|192\.168)\./.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname) || u.hostname.endsWith(".internal") || u.hostname.endsWith(".local"))
      throw badRequest("That link points inside a private network.", "BAD_URL");
    if (u.username || u.password) throw badRequest("Links with a password in them can't be used.", "BAD_URL");
    const file = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    if (!SUPPORTED.test(file)) throw badRequest("That link doesn't end in a file Continuum can read (CSV, Excel, JSON, Parquet, text, PDF, or a zip of them).", "UNSUPPORTED_FILE");
    return { url: u.toString(), file };
  }

  return {
    id: "url",
    async describe(ref) {
      const { url, file } = parse(ref);
      const modality = guessModality(file);
      return {
        connector: "url",
        ref: url,
        title: titleFor(url, file),
        description: `A file from ${new URL(url).hostname}.`,
        modalities: modality ? [modality] : isArchive(file) ? ["tabular", "text"] : [],
        tasks: [],
        licence: "unknown",
        size: {},
        tags: [],
        popularity: 0,
        configs: [],
        convertible: true,
      };
    },
    async fetchPlan(ref) {
      const { url, file } = parse(ref);
      const safe = file.replace(/[^\w.-]+/g, "_");
      return { files: [{ url, path: safe, bytes: null }], bytes: 0, rows: null, extract: isArchive(file), labelColumn: null, labelNames: null };
    },
  };
}
