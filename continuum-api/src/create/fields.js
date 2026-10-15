// src/create/fields.js
//
// The "project details" fields a variant asks for (step 4), each with the
// rule it must meet. The same patterns are sent to the wizard so it can
// check as the user types; the server checks again before creating.

export const FIELD_RULES = {
  npmName: {
    pattern: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$",
    max: 214,
    hint: "Lower case letters, digits, '-', '.', '_' (npm package name)",
  },
  slug: { pattern: "^[a-z0-9][a-z0-9-]*$", max: 100, hint: "Lower case letters, digits and '-'" },
  text: { pattern: "^[^\\u0000-\\u001f]*$", max: 300, hint: "" },
  javaGroup: { pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$", max: 200, hint: "Like com.example" },
  javaArtifact: { pattern: "^[a-z][a-z0-9-]*$", max: 100, hint: "Lower case letters, digits and '-'" },
  javaPackage: { pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$", max: 200, hint: "Like com.example.demo" },
  pythonModule: { pattern: "^[a-z_][a-z0-9_]*$", max: 100, hint: "Lower case letters, digits and '_'" },
  goModule: { pattern: "^[A-Za-z0-9.-]+(/[A-Za-z0-9._~-]+)*$", max: 200, hint: "Like github.com/you/app" },
  dotnetName: { pattern: "^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$", max: 100, hint: "Like MyCompany.Api" },
};

/**
 * Fields whose value follows others until edited, e.g. the Python module from
 * the project name. The wizard applies the same transforms as you type.
 */
export const DERIVE = {
  /** my-app → my_app */
  snake: (v) => {
    const s = String(v ?? "").toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return /^[0-9]/.test(s) ? `_${s}` : s;
  },
  /** com.example + my-app → com.example.my_app */
  javaPackage: (group, artifact) =>
    [group, artifact]
      .filter(Boolean)
      .map((p) => String(p).toLowerCase().replace(/[^a-z0-9_.]+/g, "_").replace(/(^|\.)([0-9])/g, "$1_$2"))
      .join("."),
  /** the same value (e.g. Spring's name follows the artifact) */
  same: (v) => String(v ?? ""),
  /** my-app → example.com/my-app */
  goModule: (v) => `example.com/${String(v ?? "").toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9._~-]+/g, "-")}`,
  /** my-app → MyApp */
  pascal: (v) => String(v ?? "").replace(/^@[^/]+\//, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("").replace(/^([0-9])/, "_$1"),
};

/** Field helpers for catalogue files */
export const field = (id, label, rule, extra = {}) => ({ id, label, rule, required: true, ...extra });

/** Checks details against a variant's fields; returns the clean values or throws {field, message}. */
export function checkDetails(fields, details) {
  const d = details && typeof details === "object" ? details : {};
  const out = {};
  for (const f of fields) {
    let v = d[f.id];
    v = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (!v && f.derive) v = DERIVE[f.derive.transform](...f.derive.from.map((id) => out[id] ?? d[id]));
    if (!v && f.default !== undefined) v = f.default;
    const rule = FIELD_RULES[f.rule];
    if (!v) {
      if (f.required) throw Object.assign(new Error(`${f.label} is required.`), { field: f.id });
      out[f.id] = "";
      continue;
    }
    if (v.length > rule.max || !new RegExp(rule.pattern).test(v)) {
      throw Object.assign(new Error(`${f.label}: ${rule.hint || "not valid"}.`), { field: f.id });
    }
    out[f.id] = v;
  }
  return out;
}
