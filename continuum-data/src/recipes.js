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
    hint: "Takes out rows that are copies, or near copies, of another row.",
    modalities: ["text", "tabular"],
    params: {
      mode: { kind: "enum", choices: ["near", "exact"], default: "near", label: "What counts as a copy", labels: { near: "Exact and near copies", exact: "Exact copies only" } },
      threshold: { kind: "number", min: 0.5, max: 1, step: 0.05, default: 0.8, label: "How alike a near copy is", showIf: { mode: "near" } },
      keep: { kind: "enum", choices: ["first", "longest", "shortest"], default: "first", label: "Which one to keep" },
    },
  },
  filter: {
    label: "Filter rows",
    hint: "Takes out rows that are empty, too short, too long, mostly symbols, or don't match a condition.",
    modalities: ["text", "tabular"],
    params: {
      dropEmpty: { kind: "boolean", default: true, label: "Remove empty texts", modalities: ["text"] },
      minChars: { kind: "integer", min: 0, default: null, label: "Shortest text (characters)", modalities: ["text"] },
      maxChars: { kind: "integer", min: 1, default: null, label: "Longest text (characters)", modalities: ["text"] },
      minWords: { kind: "integer", min: 0, default: null, label: "Fewest words", modalities: ["text"] },
      maxSymbolShare: { kind: "number", min: 0, max: 1, step: 0.05, default: null, label: "Most symbols allowed (share)", modalities: ["text"] },
      maxRepeatedLineShare: { kind: "number", min: 0, max: 1, step: 0.05, default: null, label: "Most repeated lines allowed (share)", modalities: ["text"] },
      dropMissingLabel: { kind: "boolean", default: true, label: "Remove rows without a label" },
      keepWhere: { kind: "text", default: null, label: "Keep only rows where (e.g. age >= 18)", placeholder: "age >= 18 AND city <> ''" },
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
    modalities: ["text", "tabular"],
    params: {
      mode: { kind: "enum", choices: ["stratified", "random", "group", "keep"], default: "stratified", label: "How", labels: { stratified: "Same label mix on each side", random: "At random", group: "Keep groups together", keep: "Keep the existing split" } },
      ratios: { kind: "ratios", default: [0.8, 0.1, 0.1], label: "Train / validation / test", showIf: { mode: ["stratified", "random", "group"] } },
      groupColumn: { kind: "column", default: null, label: "Group column", showIf: { mode: "group" } },
      seed: { kind: "integer", min: 0, default: 42, label: "Shuffle number (same number, same split)" },
      leakageCheck: { kind: "boolean", default: true, label: "Move copies so none sit on both sides" },
    },
  },
  validate: {
    label: "Check quality",
    hint: "Runs the quality checks and gives a score from 0 to 100.",
    modalities: ["text", "tabular"],
    params: {
      minRows: { kind: "integer", min: 1, default: null, label: "Fewest rows wanted" },
      minRowsPerLabel: { kind: "integer", min: 1, default: 100, label: "Fewest rows per label" },
    },
  },
};

/** Ops that write a new version (the others report on one). */
export const VERSION_OPS = new Set(["dedupe", "filter", "fix_types", "fill_missing", "outliers", "split"]);
export const EXPORT_FORMATS = ["parquet", "csv", "jsonl", "hf"];

export const TEMPLATES = [
  {
    id: "text-classifier",
    name: "Clean text for a classifier",
    description: "Remove copies and empty or tiny texts, then split with no copy on both sides.",
    modalities: ["text"],
    steps: [
      { op: "dedupe", params: { mode: "near" } },
      { op: "filter", params: { dropEmpty: true, minChars: 5 } },
      { op: "split", params: { mode: "stratified" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "chat",
    name: "Clean a chat or instruction dataset",
    description: "Remove copies and empty answers, then split.",
    modalities: ["text"],
    steps: [
      { op: "dedupe", params: { mode: "near" } },
      { op: "filter", params: { dropEmpty: true } },
      { op: "split", params: { mode: "random" } },
      { op: "validate", params: {} },
    ],
  },
  {
    id: "table",
    name: "Clean a table",
    description: "Fix column kinds, fill empty cells, pull in unusual numbers, remove copies, then split.",
    modalities: ["tabular"],
    steps: [
      { op: "fix_types", params: {} },
      { op: "fill_missing", params: { strategy: "auto" } },
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
  if (modality === "tabular") steps.push({ op: "fix_types", params: {} });
  if (ops.has("fill_missing") && modality === "tabular") steps.push({ op: "fill_missing", params: { strategy: "auto" } });
  if (ops.has("dedupe")) steps.push({ op: "dedupe", params: { mode: modality === "text" ? "near" : "exact" } });
  if (ops.has("filter") && modality === "text") steps.push({ op: "filter", params: { dropEmpty: true } });
  const hasTest = splits && (splits.test || splits.validation);
  steps.push({ op: "split", params: { mode: hasTest ? "keep" : profile?.labels?.counts?.length ? "stratified" : "random" } });
  steps.push({ op: "validate", params: {} });
  return steps;
}
