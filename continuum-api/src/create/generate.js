// src/create/generate.js
//
// Turns the wizard's choices into project files, like Spring Initializr:
//   1. check the choices against the catalogue (kind, variant, options,
//      dependencies and their requires/conflicts, details);
//   2. each chosen dependency adds its packages and contributes to the
//      template's "slots" (providers, middleware, env settings, files…);
//   3. the variant's template renders the project from those slots;
//   4. common contributors add the README, .env.example and manifests
//      (package.json…) with versions resolved inside each package's range.
// Nothing is written to disk here: the result is a list of files.

import { AppError } from "../errors/AppError.js";
import { checkDetails } from "./fields.js";
import { findKind, findVariant, dependenciesFor } from "./catalog/index.js";
import semver from "semver";
import { resolveVersion } from "./versions.js";

const invalid = (message, field) => Object.assign(new AppError(message, 400, "VALIDATION_ERROR"), { field });

/** A dependency's `when`: { option: value | [values] }, all must hold */
export const whenMatches = (when, options) =>
  Object.entries(when).every(([k, v]) => (Array.isArray(v) ? v.includes(options[k]) : options[k] === v));

/** Checks the choices; returns { kind, variant, options, deps, details }. */
export function checkChoices(choices) {
  const c = choices && typeof choices === "object" ? choices : {};
  const kind = findKind(c.kind);
  if (!kind) throw invalid("Choose what kind of project to create.", "kind");
  const variant = findVariant(kind, c.variant);
  if (!variant) throw invalid(`Choose a type of ${kind.name} project.`, "variant");

  const options = {};
  for (const o of variant.options ?? []) {
    const v = c.options?.[o.id] ?? o.default;
    if (!o.values.some((x) => x.id === v)) throw invalid(`${o.label}: choose one of the offered values.`, `options.${o.id}`);
    options[o.id] = v;
  }

  const available = new Map(dependenciesFor(kind, variant).map((d) => [d.id, d]));
  const ids = Array.isArray(c.dependencies) ? [...new Set(c.dependencies)] : [];
  if (ids.length > 60) throw invalid("Choose at most 60 dependencies.", "dependencies");
  const deps = [];
  for (const id of ids) {
    const d = available.get(id);
    if (!d) throw invalid(`“${id}” isn't available for ${variant.name}.`, "dependencies");
    if (d.when && !whenMatches(d.when, options)) {
      throw invalid(`${d.name} isn't available with these options.`, "dependencies");
    }
    deps.push(d);
  }
  const chosen = new Set(deps.map((d) => d.id));
  for (const d of deps) {
    for (const r of d.requires ?? []) {
      if (!chosen.has(r)) throw invalid(`${d.name} needs ${available.get(r)?.name ?? r}.`, "dependencies");
    }
    for (const x of d.conflicts ?? []) {
      if (chosen.has(x.id)) throw invalid(`${d.name} and ${available.get(x.id)?.name ?? x.id} can't be used together: ${x.reason}`, "dependencies");
    }
  }

  let details;
  try {
    details = checkDetails(variant.details, c.details);
  } catch (e) {
    throw invalid(e.message, `details.${e.field}`);
  }
  return { kind, variant, options, deps, details };
}

/** A fresh generation context: the files and the slots templates fill. */
function newContext({ kind, variant, options, deps, details }) {
  const files = new Map();
  const ctx = {
    kind,
    variant,
    options,
    details,
    deps,
    /** the project's (and its folder's) name: the name, or a Java artifact */
    projectName: details.name || details.artifact,
    has: (id) => deps.some((d) => d.id === id),
    files,
    /** packages per registry: { npm | pypi | go | nuget: Map(name → { range, dev }) } */
    packages: { npm: new Map(), pypi: new Map(), go: new Map(), nuget: new Map(), maven: new Map() },
    /** free-form lists a template reads (providers, middleware…) */
    slots: {},
    /** .env.example lines: [name, example, comment] */
    env: [],
    /** README: extra sections */
    readme: { setup: [], notes: [] },
    scripts: {},
    /** set by the template: where sources live, the dev server's port, public env prefix… */
    meta: {},
    /** set while a dependency contributes, so two can't write the same file */
    owner: null,
    add(path, contents, executable = false) {
      const prev = files.get(path);
      if (ctx.owner && prev?.owner && prev.owner !== ctx.owner) {
        throw new AppError(`${prev.owner} and ${ctx.owner} both write ${path}`, 500, "TEMPLATE_ERROR");
      }
      files.set(path, { contents, executable, owner: ctx.owner });
    },
    slot(name, value) {
      (ctx.slots[name] ??= []).push(value);
    },
    pkg(registry, name, range, { dev = false, extras = null } = {}) {
      const map = ctx.packages[registry];
      const prev = map.get(name);
      // A runtime need wins over a dev-only one; extras add up
      const allExtras = [...new Set([...(prev?.extras ?? []), ...(extras ? [].concat(extras) : [])])];
      map.set(name, { range, dev: prev ? prev.dev && dev : dev, extras: allExtras });
    },
  };
  return ctx;
}

/**
 * Versions for every package: { registry: Map(name → { version, range }) },
 * version being the newest within range (resolve) or null (a quick preview).
 */
async function versionsOf(ctx, resolve) {
  const out = Object.fromEntries(Object.keys(ctx.packages).map((r) => [r, new Map()]));
  const jobs = [];
  for (const [registry, map] of Object.entries(ctx.packages)) {
    for (const [name, { range }] of map) {
      jobs.push((resolve ? resolveVersion(registry, name, range) : Promise.resolve(null)).then((version) => out[registry].set(name, { version, range })));
    }
  }
  await Promise.all(jobs);
  return out;
}

/** "^19.3.1" for npm: keep the range's kind (~ stays ~), else ^; the range itself in a preview */
export const npmSpec = ({ version, range }) => (version ? `${range.trim().startsWith("~") ? "~" : "^"}${version}` : range);

/** Scripts in the order people expect; any others after them */
const SCRIPT_ORDER = ["dev", "build", "start", "preview", "lint", "typecheck", "test", "test:e2e", "format"];
const orderScripts = (scripts) =>
  Object.fromEntries(
    Object.entries(scripts).sort(([a], [b]) => (SCRIPT_ORDER.indexOf(a) + 1 || 99) - (SCRIPT_ORDER.indexOf(b) + 1 || 99))
  );

const sortObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** package.json from the context (npm projects). */
function writePackageJson(ctx, versions) {
  const deps = {};
  const devDeps = {};
  for (const [name, { dev }] of ctx.packages.npm) (dev ? devDeps : deps)[name] = npmSpec(versions.npm.get(name));
  const pkg = {
    name: ctx.details.name,
    ...(ctx.details.description && { description: ctx.details.description }),
    private: true,
    version: "0.0.0",
    // ES modules, unless the framework still needs CommonJS (Gatsby)
    ...(ctx.meta.packageType !== "commonjs" && { type: "module" }),
    ...(ctx.slots.packageFields?.reduce((a, b) => ({ ...a, ...b }), {}) ?? {}),
    scripts: orderScripts(ctx.scripts),
    ...(Object.keys(deps).length && { dependencies: sortObject(deps) }),
    ...(Object.keys(devDeps).length && { devDependencies: sortObject(devDeps) }),
  };
  ctx.add("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

/** "fastapi[standard]>=0.143.1,<1": from the resolved version up to the next major */
export function pySpec(name, { version, range, extras = [] }) {
  const v = version ?? semver.minVersion(range)?.version ?? "0.0.0";
  const major = Number(String(v).split(".")[0]);
  return `${name}${extras.length ? `[${extras.join(",")}]` : ""}>=${v},<${major >= 1 ? major + 1 : 1}`;
}

/** pyproject.toml (uv) and requirements files (pip) */
function writePythonManifest(ctx, versions) {
  const runtime = [];
  const dev = [];
  for (const [name, { dev: isDev, extras }] of [...ctx.packages.pypi].sort(([a], [b]) => a.localeCompare(b))) {
    (isDev ? dev : runtime).push(pySpec(name, { ...versions.pypi.get(name), extras }));
  }
  const list = (items) => (items.length ? `[\n${items.map((i) => `    "${i}",`).join("\n")}\n]` : "[]");
  const toml = [
    "[project]",
    `name = "${ctx.details.name}"`,
    'version = "0.1.0"',
    `description = ${JSON.stringify(ctx.details.description || "")}`,
    'readme = "README.md"',
    `requires-python = ">=${ctx.meta.python ?? "3.12"}"`,
    `dependencies = ${list(runtime)}`,
    "",
    "[dependency-groups]",
    `dev = ${list(dev)}`,
    ...(ctx.slots.pyproject ?? []).flatMap((section) => ["", section.trimEnd()]),
    "",
  ];
  ctx.add("pyproject.toml", toml.join("\n"));
  ctx.add("requirements.txt", `${runtime.join("\n")}\n`);
  ctx.add("requirements-dev.txt", `-r requirements.txt\n${dev.join("\n")}${dev.length ? "\n" : ""}`);
}

const PM_RUN = { npm: "npm run", pnpm: "pnpm", yarn: "yarn", bun: "bun run" };
const PM_INSTALL = { npm: "npm install", pnpm: "pnpm install", yarn: "yarn", bun: "bun install" };

/** README.md: what was chosen, how to run it, links to every dependency's docs. */
function writeReadme(ctx) {
  if (ctx.files.has("README.md")) return;
  const pm = ctx.options.packageManager ?? "npm";
  const lines = [`# ${ctx.projectName}`, ""];
  if (ctx.details.description) lines.push(ctx.details.description, "");
  lines.push(`A ${ctx.variant.name} project created with Continuum.`, "", "## Getting started", "");
  const commands = [...(ctx.packages.npm.size ? [PM_INSTALL[pm]] : []), ...ctx.readme.setup.map((c) => c.replaceAll("{run}", PM_RUN[pm]))];
  if (commands.length) lines.push("```sh", ...commands, "```", "");
  if (ctx.env.length) lines.push("Copy `.env.example` to `.env` and fill in the values.", "");
  for (const n of ctx.readme.notes) lines.push(n.replaceAll("{run}", PM_RUN[pm]), "");
  if (ctx.deps.length) {
    lines.push("## Dependencies", "");
    for (const d of ctx.deps) lines.push(`- **${d.name}**: ${d.description}${d.docs ? ` ([docs](${d.docs}))` : ""}`);
    lines.push("");
  }
  ctx.add("README.md", lines.join("\n"));
}

/** .env.example (names and harmless examples only, never real values). */
function writeEnvExample(ctx) {
  if (!ctx.env.length) return;
  const seen = new Set();
  const lines = [];
  for (const [name, example, comment] of ctx.env) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (comment) lines.push(`# ${comment}`);
    lines.push(`${name}=${example ?? ""}`);
  }
  ctx.add(".env.example", `${lines.join("\n")}\n`);
}

/**
 * Choices → { name, files: [[path, contents, executable]] }
 * resolve: look up the newest versions (false for a quick preview).
 */
export async function generateProject(choices, { resolve = true } = {}) {
  const checked = checkChoices(choices);
  const ctx = newContext(checked);
  const { variant } = checked;

  variant.template.prepare?.(ctx);
  for (const d of checked.deps) {
    for (const p of d.packages ?? []) ctx.pkg(p.registry ?? "npm", p.name, p.range, p);
    ctx.owner = d.id;
    d.apply?.(ctx);
    ctx.owner = null;
  }
  await variant.template.build(ctx);

  const versions = await versionsOf(ctx, resolve);
  if (ctx.packages.npm.size || variant.template.manifest === "npm") writePackageJson(ctx, versions);
  if (variant.template.manifest === "python") writePythonManifest(ctx, versions);
  variant.template.finish?.(ctx, versions);
  if (ctx.slots.gitignoreExtra?.length && ctx.files.has(".gitignore")) {
    const f = ctx.files.get(".gitignore");
    f.contents = `${String(f.contents).trimEnd()}\n\n${ctx.slots.gitignoreExtra.join("\n")}\n`;
  }
  writeEnvExample(ctx);
  writeReadme(ctx);

  for (const path of ctx.files.keys()) {
    if (!path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "" || p === ".git")) {
      throw new AppError(`Template produced an invalid path: ${path}`, 500, "TEMPLATE_ERROR");
    }
  }
  const files = [...ctx.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, f]) => [path, f.contents, f.executable]);
  return { name: ctx.projectName, kind: checked.kind.id, variant: checked.variant.id, files };
}
