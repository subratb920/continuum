import { badRequest } from "./errors.js";

/**
 * Pipeline steps users can put in a recipe (spec 4): what each one is called,
 * which data it suits, and its settings. The UI draws each step's form from
 * this list (GET /data/recipes/catalog), so the two never disagree.
 *
 * Setting kinds: enum (choices), number (min/max), integer, boolean, text,
 * columns (a list of column names), ratios (three shares adding up to 1).
 */
export const STEP_CATALOG = {
  dedupe: {
    label: "Remove copies",
    hint: "Takes out rows that are copies, or near copies, of another row (for pictures: ones that look almost the same).",
    modalities: ["text", "tabular", "image", "audio"],
    params: {
      mode: { kind: "enum", choices: ["near", "exact"], default: "near", label: "What counts as a copy", labels: { near: "Exact and near copies", exact: "Exact copies only" }, modalities: ["text", "tabular", "image"] },
      threshold: { kind: "number", min: 0.5, max: 1, step: 0.01, default: null, placeholder: "80% for text, 97% for pictures", label: "How alike a near copy is (0.5 to 1)", showIf: { mode: "near" } },
      keep: { kind: "enum", choices: ["first", "longest", "shortest"], default: "first", label: "Which one to keep" },
    },
  },
  filter: {
    label: "Filter rows",
    hint: "Takes out rows that are empty, too short, too long, too small, or don't match a condition.",
    modalities: ["text", "tabular", "image", "audio"],
    params: {
      minWidth: { kind: "integer", min: 1, default: null, label: "Narrowest picture (pixels)", modalities: ["image"] },
      minHeight: { kind: "integer", min: 1, default: null, label: "Shortest picture (pixels)", modalities: ["image"] },
      minSeconds: { kind: "number", min: 0, step: 0.1, default: null, label: "Shortest clip (seconds)", modalities: ["audio"] },
      maxSeconds: { kind: "number", min: 0.1, step: 1, default: null, label: "Longest clip (seconds)", modalities: ["audio"] },
      dropEmpty: { kind: "boolean", default: true, label: "Remove empty texts", modalities: ["text", "audio"] },
      minChars: { kind: "integer", min: 0, default: null, label: "Shortest text (characters)", modalities: ["text"] },
      maxChars: { kind: "integer", min: 1, default: null, label: "Longest text (characters)", modalities: ["text"] },
      minWords: { kind: "integer", min: 0, default: null, label: "Fewest words", modalities: ["text"] },
      maxSymbolShare: { kind: "number", min: 0, max: 1, step: 0.05, default: null, label: "Most symbols allowed (share)", modalities: ["text"] },
      maxRepeatedLineShare: { kind: "number", min: 0, max: 1, step: 0.05, default: null, label: "Most repeated lines allowed (share)", modalities: ["text"] },
      dropMissingLabel: { kind: "boolean", default: true, label: "Remove rows without a label" },
      keepWhere: { kind: "text", default: null, label: "Keep only rows where (e.g. age >= 18)", placeholder: "age >= 18 AND city <> ''", modalities: ["tabular", "text"] },
    },
  },
  fix_types: {
    label: "Fix column kinds",
    hint: "Turns text that holds numbers or yes/no into real numbers and yes/no, and trims spaces.",
    modalities: ["tabular"],
    params: {
      stripSpaces: { kind: "boolean", default: true, label: "Trim spaces" },
      columns: { kind: "columns", default: null, label: "Only these columns (all when empty)" },
    },
  },
  fill_missing: {
    label: "Fill empty cells",
    hint: "Fills empty cells (with the middle value, the most common value, or one you choose), or removes those rows.",
    modalities: ["tabular"],
    params: {
      strategy: { kind: "enum", choices: ["auto", "median", "mean", "mode", "constant", "drop"], default: "auto", label: "How", labels: { auto: "Best guess per column", median: "Middle value", mean: "Average", mode: "Most common value", constant: "A value I choose", drop: "Remove those rows" } },
      value: { kind: "text", default: null, label: "Value", showIf: { strategy: "constant" } },
      columns: { kind: "columns", default: null, label: "Only these columns (all when empty)" },
      dropMissingLabel: { kind: "boolean", default: true, label: "Remove rows without a label" },
    },
  },
  outliers: {
    label: "Handle unusual numbers",
    hint: "Finds numbers far outside the usual range and pulls them in, or removes those rows.",
    modalities: ["tabular"],
    params: {
      action: { kind: "enum", choices: ["clip", "drop"], default: "clip", label: "What to do", labels: { clip: "Pull them into range", drop: "Remove those rows" } },
      factor: { kind: "number", min: 1, max: 5, step: 0.5, default: 1.5, label: "How far is unusual (×IQR)" },
      columns: { kind: "columns", default: null, label: "Only these columns (all number columns when empty)" },
    },
  },
  split: {
    label: "Split for training and testing",
    hint: "Keeps some rows aside to check the model, with no copy on both sides.",
    modalities: ["text", "tabular", "image", "audio"],
    params: {
      mode: { kind: "enum", choices: ["stratified", "random", "group", "keep"], default: "stratified", label: "How", labels: { stratified: "Same label mix on each side", random: "At random", group: "Keep groups together", keep: "Keep the existing split" } },
      ratios: { kind: "ratios", default: [0.8, 0.1, 0.1], label: "Train / validation / test", showIf: { mode: ["stratified", "random", "group"] } },
      groupColumn: { kind: "column", default: null, label: "Group column", showIf: { mode: "group" } },
      seed: { kind: "integer", min: 0, default: 42, label: "Shuffle number (same number, same split)" },
      leakageCheck: { kind: "boolean", default: true, label: "Move copies so none sit on both sides" },
    },
  },
  redact_pii: {
    label: "Hide personal details",
    hint: "Finds emails, phone and card numbers, ID numbers and IP addresses in text (and transcripts), and replaces them with markers like [EMAIL].",
    modalities: ["text", "tabular", "audio"],
    params: {
      action: { kind: "enum", choices: ["replace", "drop", "flag"], default: "replace", label: "What to do", labels: { replace: "Replace with a marker", drop: "Remove those rows", flag: "Only mark those rows" } },
      kinds: { kind: "enum-list", choices: ["email", "phone", "card", "iban", "aadhaar", "ssn", "pan", "ip"], default: null, label: "Which details (all when none chosen)", labels: { email: "Emails", phone: "Phone numbers", card: "Card numbers", iban: "Bank accounts", aadhaar: "Aadhaar", ssn: "SSN", pan: "PAN", ip: "IP addresses" } },
    },
  },
  safety: {
    label: "Remove unsafe text",
    hint: "Takes out rows with clearly adult or abusive words. A simple word check for now.",
    modalities: ["text"],
    params: {
      action: { kind: "enum", choices: ["drop", "flag"], default: "drop", label: "What to do", labels: { drop: "Remove those rows", flag: "Only mark those rows" } },
      extraWords: { kind: "words", default: null, label: "Other words to catch (comma-separated)" },
    },
  },
  balance: {
    label: "Balance labels",
    hint: "Evens out how many rows each label has, so the model doesn't just learn the most common one. Only train rows change.",
    modalities: ["text", "tabular", "image", "audio"],
    needsLabel: true,
    params: {
      method: { kind: "enum", choices: ["under", "over", "both"], default: "under", label: "How", labels: { under: "Leave out some rows of big labels", over: "Copy rows of small labels", both: "A bit of both" } },
      targetRatio: { kind: "number", min: 0.1, max: 1, step: 0.1, default: 1, label: "Smallest label at least this share of the largest" },
      seed: { kind: "integer", min: 0, default: 42, label: "Shuffle number" },
    },
  },
  to_chat: {
    label: "Make chat examples",
    hint: "Turns two columns (a question and its answer), or a text and its label, into chat examples for training a chatbot.",
    modalities: ["text", "tabular"],
    params: {
      mode: { kind: "enum", choices: ["columns", "classify"], default: "columns", label: "From", labels: { columns: "A question column and an answer column", classify: "A text and its label" } },
      promptColumn: { kind: "column", default: null, label: "Question column", showIf: { mode: "columns" } },
      answerColumn: { kind: "column", default: null, label: "Answer column", showIf: { mode: "columns" } },
      instruction: { kind: "text", default: null, label: "Question to ask about each text", placeholder: "Which label fits this text?", showIf: { mode: "classify" } },
      systemPrompt: { kind: "text", default: null, label: "How the chatbot should behave (optional)", placeholder: "You are a friendly helper." },
    },
  },
  resize: {
    label: "Resize pictures",
    hint: "Makes every picture the same size, which most image models need.",
    modalities: ["image"],
    params: {
      size: { kind: "integer", min: 8, max: 2048, default: 224, label: "Size (pixels)" },
      mode: { kind: "enum", choices: ["crop", "pad", "fit", "stretch"], default: "crop", label: "How", labels: { crop: "Fill the square, cutting the edges", pad: "Fit inside the square, with black bars", fit: "Longest side to this size, keep the shape", stretch: "Stretch to the square" } },
      format: { kind: "enum", choices: ["jpeg", "png"], default: "jpeg", label: "Save as", labels: { jpeg: "JPEG (smaller)", png: "PNG (exact)" } },
    },
  },
  resample: {
    label: "Resample sound",
    hint: "Gives every clip the same number of samples a second (16,000 suits speech) and one channel.",
    modalities: ["audio"],
    params: {
      sampleRate: { kind: "enum-int", choices: [8000, 16000, 22050, 44100, 48000], default: 16000, label: "Samples a second" },
      mono: { kind: "boolean", default: true, label: "Mix down to one channel" },
      format: { kind: "enum", choices: ["flac", "wav"], default: "flac", label: "Save as", labels: { flac: "FLAC (smaller, exact)", wav: "WAV" } },
    },
  },
  augment: {
    label: "Make more examples",
    hint: "Adds changed copies of training examples (flipped, turned, lighter or darker; for sound: louder, faster, a little noise), so the model learns to cope with change.",
    modalities: ["image", "audio"],
    params: {
      copies: { kind: "integer", min: 1, max: 5, default: 1, label: "New copies per example" },
      flip: { kind: "boolean", default: true, label: "Flip some left to right", modalities: ["image"] },
      rotate: { kind: "number", min: 0, max: 45, step: 5, default: 10, label: "Turn up to (degrees)", modalities: ["image"] },
      brightness: { kind: "number", min: 0, max: 0.8, step: 0.1, default: 0.2, label: "Lighter or darker by up to", modalities: ["image"] },
      crop: { kind: "number", min: 0, max: 0.5, step: 0.05, default: 0.1, label: "Cut off up to (share)", modalities: ["image"] },
      noise: { kind: "number", min: 0, max: 0.05, step: 0.001, default: 0.003, label: "Background noise", modalities: ["audio"] },
      gain: { kind: "number", min: 0, max: 0.8, step: 0.1, default: 0.2, label: "Louder or quieter by up to", modalities: ["audio"] },
      speed: { kind: "number", min: 0, max: 0.3, step: 0.05, default: 0.1, label: "Faster or slower by up to", modalities: ["audio"] },
      seed: { kind: "integer", min: 0, default: 42, label: "Shuffle number" },
    },
  },
  validate: {
    label: "Check quality",
    hint: "Runs the quality checks and gives a score from 0 to 100.",
    modalities: ["text", "tabular", "image", "audio"],
    params: {
      minRows: { kind: "integer", min: 1, default: null, label: "Fewest rows wanted" },
      minRowsPerLabel: { kind: "integer", min: 1, default: 100, label: "Fewest rows per label" },
    },
  },
};

/** Ops that write a new version (the others report on one). */
export const VERSION_OPS = new Set(["dedupe", "filter", "fix_types", "fill_missing", "outliers", "split", "redact_pii", "safety", "balance", "to_chat", "resize", "resample", "augment"]);
export const EXPORT_FORMATS = ["parquet", "csv", "jsonl", "hf", "imagefolder", "audiofolder"];
/** Which downloads suit which data (images and audio carry their files inside). */
export const EXPORT_FORMATS_FOR = { text: ["hf", "parquet", "csv", "jsonl"], tabular: ["hf", "parquet", "csv", "jsonl"], image: ["hf", "imagefolder", "parquet"], audio: ["hf", "audiofolder", "parquet"] };

export const TEMPLATES = [
  {
    id: "images",
    name: "Clean pictures for a classifier",
    description: "Remove copies and look-alikes, make every picture 224 × 224, then split with no look-alike on both sides.",
    modalities: ["image"],
    steps: [
      { op: "dedupe", params: { mode: "near" } },
      { op: "resize", params: { size: 224, mode: "crop" } },
      { op: "split", params: { mode: "stratified" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "speech",
    name: "Clean speech for transcription",
    description: "16,000 samples a second in one channel, drop clips that are cut off or too long, hide personal details in transcripts, then split.",
    modalities: ["audio"],
    steps: [
      { op: "dedupe", params: {} },
      { op: "resample", params: { sampleRate: 16000, mono: true } },
      { op: "filter", params: { minSeconds: 0.2, maxSeconds: 30 } },
      { op: "redact_pii", params: {} },
      { op: "split", params: { mode: "random" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "text-classifier",
    name: "Clean text for a classifier",
    description: "Hide personal details, remove unsafe text, copies and empty or tiny texts, then split with no copy on both sides.",
    modalities: ["text"],
    steps: [
      { op: "redact_pii", params: {} },
      { op: "safety", params: {} },
      { op: "dedupe", params: { mode: "near" } },
      { op: "filter", params: { dropEmpty: true, minChars: 5 } },
      { op: "split", params: { mode: "stratified" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "chat",
    name: "Clean a chat or instruction dataset",
    description: "Hide personal details, remove unsafe text, copies and empty answers, then split.",
    modalities: ["text"],
    steps: [
      { op: "redact_pii", params: {} },
      { op: "safety", params: {} },
      { op: "dedupe", params: { mode: "near" } },
      { op: "filter", params: { dropEmpty: true } },
      { op: "split", params: { mode: "random" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "table",
    name: "Clean a table",
    description: "Fix column kinds, fill empty cells, hide personal details, pull in unusual numbers, remove copies, then split.",
    modalities: ["tabular"],
    steps: [
      { op: "fix_types", params: {} },
      { op: "fill_missing", params: { strategy: "auto" } },
      { op: "redact_pii", params: {} },
      { op: "outliers", params: { action: "clip" } },
      { op: "dedupe", params: { mode: "exact" } },
      { op: "split", params: { mode: "stratified" } },
      { op: "validate", params: {} },
    ],
  },
];

function checkParam(op, name, spec, value) {
  if (value === null || value === undefined || value === "") return null;
  const bad = (why) => badRequest(`${STEP_CATALOG[op].label}: ${spec.label ?? name} ${why}.`, "BAD_STEP");
  switch (spec.kind) {
    case "enum":
      if (!spec.choices.includes(value)) throw bad(`must be one of ${spec.choices.join(", ")}`);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw bad("must be yes or no");
      return value;
    case "number":
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n) || (spec.kind === "integer" && !Number.isInteger(n))) throw bad(`must be ${spec.kind === "integer" ? "a whole number" : "a number"}`);
      if (spec.min !== undefined && n < spec.min) throw bad(`must be at least ${spec.min}`);
      if (spec.max !== undefined && n > spec.max) throw bad(`must be at most ${spec.max}`);
      return n;
    }
    case "text":
      if (typeof value !== "string" || value.length > 500) throw bad("must be a short text");
      return value;
    case "column":
      if (typeof value !== "string" || value.length > 200) throw bad("must be a column name");
      return value;
    case "columns":
      if (!Array.isArray(value) || value.some((c) => typeof c !== "string")) throw bad("must be a list of column names");
      return value.length ? value.slice(0, 200) : null;
    case "enum-int": {
      const n = Number(value);
      if (!spec.choices.includes(n)) throw bad(`must be one of ${spec.choices.join(", ")}`);
      return n;
    }
    case "enum-list":
      if (!Array.isArray(value) || value.some((c) => !spec.choices.includes(c))) throw bad(`must be some of ${spec.choices.join(", ")}`);
      return value.length ? [...new Set(value)] : null;
    case "words": {
      const list = (Array.isArray(value) ? value : String(value).split(",")).map((w) => String(w).trim()).filter(Boolean);
      if (list.length > 200 || list.some((w) => w.length > 60)) throw bad("must be up to 200 short words");
      return list.length ? list : null;
    }
    case "ratios": {
      if (!Array.isArray(value) || value.length !== 3 || value.some((x) => !Number.isFinite(Number(x)) || Number(x) < 0)) throw bad("must be three shares");
      const r = value.map(Number);
      if (Math.abs(r[0] + r[1] + r[2] - 1) > 1e-6 || r[0] === 0) throw bad("must add up to 1, with some rows for training");
      return r;
    }
    default:
      throw bad("isn't a known setting");
  }
}

/**
 * Checks a list of steps and fills in defaults. Unknown ops or settings are
 * refused; steps switched off are left out. At most 20 steps.
 */
export function normaliseSteps(steps, modality) {
  if (!Array.isArray(steps) || !steps.length) throw badRequest("Add at least one step.", "NO_STEPS");
  if (steps.length > 20) throw badRequest("At most 20 steps in one pipeline.", "TOO_MANY_STEPS");
  const out = [];
  for (const s of steps) {
    const spec = STEP_CATALOG[s?.op];
    if (!spec) throw badRequest(`"${s?.op}" isn't a step Continuum knows.`, "BAD_STEP");
    if (s.enabled === false) continue;
    if (modality && !spec.modalities.includes(modality)) throw badRequest(`${spec.label} doesn't work on this kind of data.`, "BAD_STEP");
    const params = {};
    for (const [name, value] of Object.entries(s.params ?? {})) {
      if (!spec.params[name]) throw badRequest(`${spec.label} has no setting "${name}".`, "BAD_STEP");
      const v = checkParam(s.op, name, spec.params[name], value);
      if (v !== null) params[name] = v;
    }
    for (const [name, p] of Object.entries(spec.params)) if (params[name] === undefined && p.default !== null && p.default !== undefined) params[name] = p.default;
    out.push({ op: s.op, params });
  }
  if (!out.length) throw badRequest("Every step is switched off.", "NO_STEPS");
  return out;
}

/**
 * A recipe made from what the profile noticed: each finding that has a fix
 * becomes its step, and a split and a quality check come last.
 */
export function suggestSteps(profile, modality, splits) {
  const ops = new Set((profile?.findings ?? []).map((f) => f.suggest).filter(Boolean));
  const steps = [];
  const hasTest = splits?.train && (splits.test || splits.validation);
  const splitStep = { op: "split", params: { mode: hasTest ? "keep" : profile?.labels?.counts?.length ? "stratified" : "random" } };
  if (modality === "image") {
    steps.push({ op: "dedupe", params: { mode: "near" } });
    if (ops.has("filter")) steps.push({ op: "filter", params: { minWidth: 32, minHeight: 32 } });
    if (ops.has("resize")) steps.push({ op: "resize", params: { size: 224, mode: "crop" } });
    steps.push(splitStep, { op: "validate", params: {} });
    return steps;
  }
  if (modality === "audio") {
    steps.push({ op: "dedupe", params: {} });
    if (ops.has("resample")) steps.push({ op: "resample", params: { sampleRate: 16000, mono: true } });
    if (ops.has("filter")) steps.push({ op: "filter", params: { minSeconds: 0.2 } });
    if (profile?.task === "transcribe") steps.push({ op: "redact_pii", params: {} });
    steps.push(splitStep, { op: "validate", params: {} });
    return steps;
  }
  if (modality === "tabular") steps.push({ op: "fix_types", params: {} });
  if (ops.has("fill_missing") && modality === "tabular") steps.push({ op: "fill_missing", params: { strategy: "auto" } });
  // On by default (spec 9.1): personal details hidden, unsafe text removed.
  // Before removing copies: hiding details can turn two texts into copies.
  steps.push({ op: "redact_pii", params: {} });
  if (modality === "text") steps.push({ op: "safety", params: {} });
  if (ops.has("dedupe")) steps.push({ op: "dedupe", params: { mode: modality === "text" ? "near" : "exact" } });
  if (ops.has("filter") && modality === "text") steps.push({ op: "filter", params: { dropEmpty: true } });
  steps.push(splitStep);
  if (ops.has("balance") && profile?.labels?.counts?.length) steps.push({ op: "balance", params: { method: "under" } });
  steps.push({ op: "validate", params: {} });
  return steps;
}
