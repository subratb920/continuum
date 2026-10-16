/** Words and numbers for the Data screen. */

export const STEP_LABEL = {
  fetch: "Download",
  ingest: "Read and tidy up",
  profile: "Measure",
  dedupe: "Remove copies",
  filter: "Filter rows",
  fix_types: "Fix column kinds",
  fill_missing: "Fill empty cells",
  outliers: "Handle unusual numbers",
  split: "Split for training and testing",
  redact_pii: "Hide personal details",
  safety: "Remove unsafe text",
  balance: "Balance labels",
  to_chat: "Make chat examples",
  resize: "Resize pictures",
  resample: "Resample sound",
  augment: "Make more examples",
  validate: "Check quality",
  export: "Pack for download",
};

export const EXPORT_LABEL = {
  hf: "Hugging Face folder (Parquet per split)",
  parquet: "Parquet files",
  csv: "CSV spreadsheets",
  jsonl: "JSON Lines",
  imagefolder: "Folders of pictures (one per label)",
  audiofolder: "Sound files with a metadata.csv",
};

export const STEP_HINT = {
  fetch: "Getting the files from the source.",
  ingest: "Turning the files into one clean table, with where every row came from.",
  profile: "Counting rows, labels, gaps and copies, so you know what you have.",
  validate: "Running the quality checks.",
  export: "Packing the files into one download.",
};

export const CONNECTOR_LABEL = { huggingface: "Hugging Face", openml: "OpenML", uci: "UCI", kaggle: "Kaggle", url: "Link", upload: "Your files" };

export const MODALITY_LABEL = { text: "Text", tabular: "Table", image: "Images", audio: "Audio" };
export const MODALITY_ICON = { text: "¶", tabular: "▦", image: "◩", audio: "♪" };
export const TASK_LABEL = {
  classify: "Sort into labels",
  regress: "Predict a number",
  detect: "Find objects",
  transcribe: "Speech to text",
  collect: "A collection",
  chat: "Answer and chat",
  generate: "Write text",
};

export const STATE_LABEL = { building: "Building", ready: "Ready", failed: "Stopped", cancelled: "Cancelled" };

/** What D1 can turn into a dataset (images and audio follow in D3). */
export const READY_MODALITIES = ["text", "tabular", "image", "audio"];

export const UPLOAD_TYPES = ".csv,.tsv,.json,.jsonl,.ndjson,.parquet,.xlsx,.txt,.md,.html,.htm,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.wav,.flac,.mp3,.ogg,.m4a,.zip";

const nf = new Intl.NumberFormat();
export const count = (n) => (n === null || n === undefined ? "—" : nf.format(n));

export function compact(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  const units = [["B", 1e9], ["M", 1e6], ["K", 1e3]];
  for (const [u, v] of units) if (n >= v) return `${(n / v).toFixed(n / v < 10 ? 1 : 0).replace(/\.0$/, "")}${u}`;
  return String(n);
}

export function bytes(n) {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
}

export const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

export function timeAgo(date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(date).toLocaleDateString();
}

export const clock = (date) => new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** A cell for the table: chat messages, lists and objects in a short readable form. */
export function seconds(n) {
  if (n === null || n === undefined) return "—";
  if (n < 60) return `${Math.round(n * 10) / 10} s`;
  const m = Math.floor(n / 60);
  return `${m} min ${Math.round(n - m * 60)} s`;
}

export function cellText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.every((m) => m && typeof m === "object" && "role" in m)) return value.map((m) => `${m.role}: ${m.content}`).join("  ·  ");
    return value.map(cellText).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
