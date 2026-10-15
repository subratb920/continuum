import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { checkGithubRepoName, createProject, fetchCreateCatalog, fetchGithubCreateStatus, generateNewProject, previewNewProject } from "../../api";
import { canCreateFolders, createProjectFolder, filesOfTarball, NO_FOLDERS_NOTE, pickParentFolder, removeProjectFolder, writeFiles } from "../../utils/deviceFolder";
import { formatBytes, MAX_ENTRIES } from "../../utils/importFromDevice";
import { getPreferences } from "../../utils/preferences";
import BrandIcon from "./BrandIcon";
import "./NewProject.css";

/**
 * New Project wizard (like Spring Initializr, for every stack):
 * kind → type → dependencies → details → git → review → Create.
 * Everything it offers comes from the server's catalogue (GET /create/catalog);
 * the server generates the project and the browser writes it into a folder
 * the user picks (Chrome/Edge on a computer). The choices live in the URL,
 * so a setup can be reopened or shared.
 */

const STEPS = ["Kind", "Type", "Dependencies", "Details", "Git", "Review"];

/** Paths that are never listed as a project's contents (same as Import from device) */
const NOT_LISTED = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;

/** Fields that follow others until edited (same transforms as the server's fields.js) */
const DERIVE = {
  snake: (v) => {
    const s = String(v ?? "").toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return /^[0-9]/.test(s) ? `_${s}` : s;
  },
  javaPackage: (group, artifact) =>
    [group, artifact]
      .filter(Boolean)
      .map((p) => String(p).toLowerCase().replace(/[^a-z0-9_.]+/g, "_").replace(/(^|\.)([0-9])/g, "$1_$2"))
      .join("."),
  same: (v) => String(v ?? ""),
  goModule: (v) => `example.com/${String(v ?? "").toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9._~-]+/g, "-")}`,
  pascal: (v) =>
    String(v ?? "")
      .replace(/^@[^/]+\//, "")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("")
      .replace(/^([0-9])/, "_$1"),
};

/** Details with every derived field recomputed from its sources, except the ones the user edited */
function withDerived(variant, details, edited) {
  const out = { ...details };
  for (const f of variant?.details ?? []) {
    if (f.derive && !edited.has(f.id) && DERIVE[f.derive.transform]) out[f.id] = DERIVE[f.derive.transform](...f.derive.from.map((id) => out[id]));
  }
  return out;
}

function defaultsFor(variant) {
  const options = Object.fromEntries((variant?.options ?? []).map((o) => [o.id, o.default]));
  const details = withDerived(variant, Object.fromEntries((variant?.details ?? []).map((f) => [f.id, f.default ?? ""])), new Set());
  return { options, details };
}

/** The project's (and folder's) name: the name, or a Java artifact */
const projectNameOf = (details) => String(details.name || details.artifact || "").replace(/^@[^/]+\//, "");

/** Does the chosen option value satisfy a dependency's `when` ({ option: value | [values] })? */
const whenMatches = (when, options) => Object.entries(when).every(([k, v]) => (Array.isArray(v) ? v.includes(options[k]) : options[k] === v));

/** The choices kept in the URL → the wizard's state (unknown values are dropped). */
function fromParams(params, catalog) {
  const kind = catalog.kinds.find((k) => k.id === params.get("kind")) ?? null;
  const variant = kind?.variants.find((v) => v.id === params.get("variant")) ?? (kind?.variants.length === 1 ? kind.variants[0] : null);
  const { options, details } = defaultsFor(variant);
  for (const o of variant?.options ?? []) {
    const v = params.get(`o.${o.id}`);
    if (o.values.some((x) => x.id === v)) options[o.id] = v;
  }
  for (const f of variant?.details ?? []) {
    const v = params.get(f.id === "name" ? "name" : `d.${f.id}`);
    if (v != null) details[f.id] = v;
  }
  const edited = new Set(
    (variant?.details ?? []).filter((f) => f.derive && params.get(f.id === "name" ? "name" : `d.${f.id}`) != null && params.get(f.id === "name" ? "name" : `d.${f.id}`) !== withDerived(variant, details, new Set())[f.id]).map((f) => f.id)
  );
  const known = new Set((kind?.dependencies ?? []).map((d) => d.id));
  const dependencies = (params.get("deps") ?? "").split(",").filter((id) => known.has(id));
  const step = Math.min(Math.max(Number(params.get("step")) || 0, 0), STEPS.length - 1);
  return { kind, variant, options, details: withDerived(variant, details, edited), edited, dependencies, step: kind ? step : 0 };
}

function toParams(s) {
  const p = new URLSearchParams();
  if (s.kind) p.set("kind", s.kind.id);
  if (s.variant) p.set("variant", s.variant.id);
  for (const [k, v] of Object.entries(s.options)) p.set(`o.${k}`, v);
  if (s.dependencies.length) p.set("deps", s.dependencies.join(","));
  for (const [k, v] of Object.entries(s.details)) if (v) p.set(k === "name" ? "name" : `d.${k}`, v);
  if (s.step) p.set("step", String(s.step));
  return p;
}

/** The dependencies the chosen type offers, each with why it can't be picked (if so). */
function dependencyStates(kind, variant, options, chosen) {
  if (!kind || !variant) return [];
  const all = kind.dependencies.filter((d) => d.appliesTo === "*" || d.appliesTo.includes(variant.id));
  const byId = new Map(all.map((d) => [d.id, d]));
  return all.map((d) => {
    let blocked = null;
    if (d.when && !whenMatches(d.when, options)) {
      const opt = variant.options.find((o) => o.id === Object.keys(d.when)[0]);
      const label = opt?.values.find((x) => x.id === options[opt.id])?.label ?? options[opt?.id];
      blocked = d.versionRange ? `Needs ${opt?.label ?? "a different version"} ${d.versionRange} (you chose ${label})` : `Not available with ${opt?.label ?? "these options"} ${label}`;
    }
    for (const c of d.conflicts) if (chosen.includes(c.id)) blocked = `Can't be used with ${byId.get(c.id)?.name ?? c.id}: ${c.reason}`;
    for (const other of chosen) {
      const c = byId.get(other)?.conflicts.find((x) => x.id === d.id);
      if (c) blocked = `Can't be used with ${byId.get(other).name}: ${c.reason}`;
    }
    return { ...d, blocked: chosen.includes(d.id) ? null : blocked };
  });
}

function detailError(field, value, rules) {
  const v = String(value ?? "").trim();
  if (!v) return field.required ? `${field.label} is required.` : null;
  const rule = rules[field.rule];
  if (!rule) return null;
  if (v.length > rule.max || !new RegExp(rule.pattern).test(v)) return rule.hint || "Not valid.";
  return null;
}

export default function NewProject({ onCreated, onEmptyProject, onCancel }) {
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState(null);
  const [git, setGit] = useState(() => getPreferences().newProjectGit !== false);
  // "Create a repository on GitHub?" is always asked: no default answer, never remembered
  const [github, setGithub] = useState({ answer: null, name: "", private: true, nameEdited: false });
  const [githubStatus, setGithubStatus] = useState(null); // { connected, login?, reason? }
  const [repoCheck, setRepoCheck] = useState(null); // { name, available } | { name, error } | { name, checking }
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetchCreateCatalog()
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        setState(fromParams(params, c));
      })
      .catch((e) => live && setLoadError(e.message || "The catalogue couldn't be loaded."));
    return () => {
      live = false;
    };
    // The URL is read once, when the catalogue arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchGithubCreateStatus()
      .then(setGithubStatus)
      .catch(() => setGithubStatus({ connected: false, reason: "GitHub couldn't be checked." }));
  }, []);

  // The repository name follows the project name until edited
  const projectName = state ? projectNameOf(state.details) : "";
  const repoName = github.nameEdited ? github.name : projectName;

  // Is that name free? (checked as it's typed, a moment after typing stops)
  useEffect(() => {
    if (github.answer !== "yes" || !repoName || !/^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/.test(repoName)) return;
    let live = true;
    setRepoCheck({ name: repoName, checking: true });
    const t = setTimeout(() => {
      checkGithubRepoName(repoName)
        .then((r) => live && setRepoCheck({ name: repoName, available: r.available, owner: r.owner }))
        .catch((e) => live && setRepoCheck({ name: repoName, error: e.message }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [github.answer, repoName]);

  // Keep the URL in step with the choices (replace: Back leaves the wizard)
  useEffect(() => {
    if (state) setParams(toParams(state), { replace: true });
  }, [state, setParams]);

  const choices = useMemo(
    () =>
      state && {
        kind: state.kind?.id,
        variant: state.variant?.id,
        options: state.options,
        dependencies: state.dependencies,
        details: state.details,
        git: { init: git, github: { create: github.answer === "yes", name: repoName, private: github.private } },
      },
    [state, git, github.answer, github.private, repoName]
  );

  // Review: the file list for these choices
  useEffect(() => {
    if (!state || state.step !== 5) return;
    let live = true;
    setPreview(null);
    previewNewProject(choices)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError({ message: e.message, field: e.field }));
    return () => {
      live = false;
    };
  }, [state, choices]);

  if (loadError) {
    return (
      <div className="np-page">
        <p className="np-error" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!catalog || !state) {
    return (
      <div className="np-page">
        <p className="np-muted">Loading…</p>
      </div>
    );
  }

  const { kind, variant, options, details, dependencies, step } = state;
  const deps = dependencyStates(kind, variant, options, dependencies);
  const detailErrors = Object.fromEntries((variant?.details ?? []).map((f) => [f.id, detailError(f, details[f.id], catalog.rules)]));
  const repoNameValid = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/.test(repoName) && !repoName.endsWith(".git");
  const githubAnswered =
    github.answer === "no" || (github.answer === "yes" && repoNameValid && repoCheck?.name === repoName && repoCheck.available === true);
  const stepValid = [Boolean(kind), Boolean(variant), true, Object.values(detailErrors).every((e) => !e), githubAnswered, Boolean(preview)];
  const reachable = (i) => stepValid.slice(0, i).every(Boolean);
  const update = (patch) => {
    setError(null);
    setState((s) => ({ ...s, ...patch }));
  };
  const go = (i) => reachable(i) && update({ step: i });

  function chooseKind(k) {
    if (kind?.id === k.id) return go(1);
    const v = k.variants.length === 1 ? k.variants[0] : null;
    update({ kind: k, variant: v, ...defaultsFor(v), edited: new Set(), dependencies: [], step: 1 });
  }

  function chooseVariant(v) {
    if (variant?.id === v.id) return;
    const d = defaultsFor(v);
    const fits = new Set(kind.dependencies.filter((x) => x.appliesTo === "*" || x.appliesTo.includes(v.id)).map((x) => x.id));
    const kept = { ...d.details, ...pick(details, Object.keys(d.details)) };
    update({ variant: v, options: d.options, details: withDerived(v, kept, state.edited), dependencies: dependencies.filter((id) => fits.has(id)) });
  }

  function toggleDependency(d) {
    if (dependencies.includes(d.id)) {
      // Also drop what needed it
      const needs = (id) => kind.dependencies.filter((x) => x.requires.includes(id)).map((x) => x.id);
      const drop = new Set([d.id]);
      for (const id of [...drop]) for (const n of needs(id)) drop.add(n);
      update({ dependencies: dependencies.filter((id) => !drop.has(id)) });
    } else if (!d.blocked) {
      update({ dependencies: [...new Set([...dependencies, ...d.requires, d.id])] });
    }
  }

  async function create() {
    setError(null);
    if (!canCreateFolders()) return;
    // The folder first: browsers only open the picker straight after a click
    let parent;
    try {
      parent = await pickParentFolder();
    } catch (e) {
      setError({ message: `The folder couldn't be opened: ${e.message}` });
      return;
    }
    if (!parent) return;

    let folder = null;
    try {
      setBusy(github.answer === "yes" ? "Creating the project and its GitHub repository…" : "Creating the project…");
      const res = await generateNewProject(choices);
      const files = await filesOfTarball(res);
      folder = await createProjectFolder(parent, projectNameOf(details));
      await writeFiles(folder.handle, files, (done, total) => setBusy(`Writing files… ${done} of ${total}`));

      setBusy("Adding it to your projects…");
      const listed = files.filter((f) => !NOT_LISTED.test(f.path));
      const contents = {
        folder: folder.name,
        entries: listed.slice(0, MAX_ENTRIES).map((f) => [f.path, f.data.length]),
        truncated: listed.length > MAX_ENTRIES,
      };
      const githubRepoUrl = res.headers.get("X-GitHub-Repo");
      const project = await createProject(projectNameOf(details), { source: "device", contents, ...(githubRepoUrl && { githubRepoUrl }) });
      onCreated(project);
    } catch (e) {
      if (folder) await removeProjectFolder(parent, folder.name).catch(() => {});
      setBusy("");
      const field = e.field ?? null;
      setError({ message: e.message || "The project couldn't be created.", field });
      const at = field?.startsWith("details.") ? 3 : field?.startsWith("git.") ? 4 : field === "dependencies" ? 2 : field?.startsWith("options.") || field === "variant" ? 1 : field === "kind" ? 0 : null;
      if (at != null) update({ step: at });
    }
  }

  const filtered = query.trim()
    ? deps.filter((d) => `${d.name} ${d.description}`.toLowerCase().includes(query.trim().toLowerCase()))
    : deps;
  const canCreate = canCreateFolders();

  return (
    <div className="np-page">
      <header className="np-head">
        <h1>New project</h1>
        <p className="np-muted">Choose what to build; Continuum creates the starter project in a folder on this device.</p>
      </header>

      <ol className="np-steps" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              className={["np-step", i === step && "is-current", i < step && "is-done"].filter(Boolean).join(" ")}
              onClick={() => go(i)}
              disabled={!reachable(i)}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="np-step-num">{i < step ? "✓" : i + 1}</span>
              <span className="np-step-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="np-body" aria-live="polite">
        {step === 0 && (
          <>
            <h2>What kind of project?</h2>
            <div className="np-grid">
              {catalog.kinds.map((k) => (
                <button key={k.id} type="button" className={`np-card${kind?.id === k.id ? " is-selected" : ""}`} onClick={() => chooseKind(k)} aria-pressed={kind?.id === k.id}>
                  <BrandIcon name={k.icon} label={k.name} size={32} />
                  <span className="np-card-name">{k.name}</span>
                  <span className="np-card-text">{k.description}</span>
                  <span className="np-card-meta">
                    {k.variants.length} {k.variants.length === 1 ? "type" : "types"}
                  </span>
                </button>
              ))}
              <button type="button" className="np-card np-card-empty" onClick={onEmptyProject}>
                <span className="np-logo-fallback" style={{ width: 32, height: 32, fontSize: 20 }} aria-hidden="true">
                  +
                </span>
                <span className="np-card-name">Empty project</span>
                <span className="np-card-text">Just a name (and, if you like, an empty folder).</span>
              </button>
            </div>
          </>
        )}

        {step === 1 && kind && (
          <>
            <h2>
              <BrandIcon name={kind.icon} label={kind.name} size={22} /> Which type of {kind.name} project?
            </h2>
            <div className="np-grid">
              {kind.variants.map((v) => (
                <button key={v.id} type="button" className={`np-card${variant?.id === v.id ? " is-selected" : ""}`} onClick={() => chooseVariant(v)} aria-pressed={variant?.id === v.id}>
                  <BrandIcon name={v.icon} label={v.name} size={28} />
                  <span className="np-card-name">{v.name}</span>
                  <span className="np-card-text">{v.description}</span>
                </button>
              ))}
            </div>
            {variant?.options.map((o) => (
              <fieldset key={o.id} className="np-option">
                <legend>{o.label}</legend>
                <div className="np-segments">
                  {o.values.map((x) => (
                    <label key={x.id} className={`np-segment${options[o.id] === x.id ? " is-selected" : ""}`}>
                      <input type="radio" name={`opt-${o.id}`} value={x.id} checked={options[o.id] === x.id} onChange={() => update({ options: { ...options, [o.id]: x.id } })} />
                      {x.icon && <BrandIcon name={x.icon} label={x.label} size={16} />}
                      {x.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </>
        )}

        {step === 2 && variant && (
          <>
            <h2>Dependencies</h2>
            {deps.length > 0 && <p className="np-muted">Optional. Each one is added with its setup; you can add more later.</p>}
            <div className="np-chips" aria-label="Chosen dependencies">
              {dependencies.length === 0 && <span className="np-muted">None chosen.</span>}
              {dependencies.map((id) => {
                const d = deps.find((x) => x.id === id);
                return (
                  <button key={id} type="button" className="np-chip" onClick={() => toggleDependency(d)} aria-label={`Remove ${d?.name ?? id}`}>
                    {d && <BrandIcon name={d.icon} label={d.name} size={14} />}
                    {d?.name ?? id} <span aria-hidden="true">×</span>
                  </button>
                );
              })}
            </div>
            <input type="search" className="np-search" placeholder="Search dependencies" aria-label="Search dependencies" value={query} onChange={(e) => setQuery(e.target.value)} />
            {kind.groups
              .map((g) => ({ ...g, items: filtered.filter((d) => d.group === g.id) }))
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.id} className="np-group">
                  <h3>{g.name}</h3>
                  <div className="np-dep-list">
                    {g.items.map((d) => {
                      const on = dependencies.includes(d.id);
                      return (
                        <label key={d.id} className={["np-dep", on && "is-selected", d.blocked && "is-blocked"].filter(Boolean).join(" ")} title={d.blocked ?? undefined}>
                          <input type="checkbox" checked={on} disabled={Boolean(d.blocked)} onChange={() => toggleDependency(d)} />
                          <BrandIcon name={d.icon} label={d.name} size={22} />
                          <span className="np-dep-text">
                            <span className="np-dep-name">{d.name}</span>
                            <span className="np-dep-desc">{d.blocked ?? d.description}</span>
                          </span>
                          {d.docs && (
                            <a className="np-dep-docs" href={d.docs} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`${d.name} documentation`}>
                              Docs
                            </a>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            {deps.length === 0 && <p className="np-muted">This type has nothing extra to add; go on to the details.</p>}
            {deps.length > 0 && filtered.length === 0 && <p className="np-muted">No dependency matches “{query}”.</p>}
          </>
        )}

        {step === 3 && variant && (
          <>
            <h2>Project details</h2>
            <div className="np-form">
              {variant.details.map((f) => {
                const err = detailErrors[f.id] && String(details[f.id] ?? "") !== "" ? detailErrors[f.id] : null;
                const serverErr = error?.field === `details.${f.id}` ? error.message : null;
                return (
                  <label key={f.id} className="np-field">
                    <span className="np-field-label">
                      {f.label}
                      {!f.required && <span className="np-muted"> (optional)</span>}
                    </span>
                    <input
                      value={details[f.id] ?? ""}
                      placeholder={f.placeholder ?? ""}
                      aria-invalid={Boolean(err || serverErr)}
                      onChange={(e) => {
                        const edited = new Set(state.edited);
                        if (f.derive) {
                          // Emptying a derived field hands it back to its sources
                          if (e.target.value) edited.add(f.id);
                          else edited.delete(f.id);
                        }
                        update({ edited, details: withDerived(variant, { ...details, [f.id]: e.target.value }, edited) });
                      }}
                    />
                    <span className={err || serverErr ? "np-field-error" : "np-field-help"}>{err || serverErr || f.help || catalog.rules[f.rule]?.hint}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Git</h2>
            <label className="np-toggle">
              <input type="checkbox" checked={git} disabled={github.answer === "yes"} title={github.answer === "yes" ? "A GitHub repository needs it" : undefined} onChange={(e) => setGit(e.target.checked)} />
              <BrandIcon name="SiGit" label="Git" size={22} />
              <span>
                <span className="np-dep-name">Initialise a git repository</span>
                <span className="np-dep-desc">The folder starts as a git repository on branch main, with a first commit of the starter files.</span>
              </span>
            </label>

            <fieldset className="np-option np-github">
              <legend>
                <BrandIcon name="SiGithub" label="GitHub" size={16} /> Create a repository on GitHub?
              </legend>
              <div className="np-segments">
                <label className={`np-segment${github.answer === "yes" ? " is-selected" : ""}${githubStatus?.connected ? "" : " is-disabled"}`} title={githubStatus?.connected ? undefined : githubStatus?.reason}>
                  <input
                    type="radio"
                    name="github"
                    checked={github.answer === "yes"}
                    disabled={!githubStatus?.connected}
                    onChange={() => {
                      setGit(true);
                      setGithub((g) => ({ ...g, answer: "yes" }));
                    }}
                  />
                  Yes, create it
                </label>
                <label className={`np-segment${github.answer === "no" ? " is-selected" : ""}`}>
                  <input type="radio" name="github" checked={github.answer === "no"} onChange={() => setGithub((g) => ({ ...g, answer: "no" }))} />
                  No
                </label>
              </div>
              {github.answer === null && <p className="np-muted np-github-hint">Choose Yes or No to continue.</p>}
              {githubStatus && !githubStatus.connected && <p className="np-muted np-github-hint">{githubStatus.reason}</p>}

              {github.answer === "yes" && (
                <div className="np-form np-github-form">
                  <label className="np-field">
                    <span className="np-field-label">Repository</span>
                    <span className="np-repo-input">
                      <span className="np-muted">{githubStatus?.login}/</span>
                      <input
                        value={repoName}
                        aria-invalid={!repoNameValid || repoCheck?.available === false || error?.field === "git.github.name"}
                        onChange={(e) => setGithub((g) => ({ ...g, name: e.target.value, nameEdited: true }))}
                      />
                    </span>
                    <span className={!repoNameValid || repoCheck?.available === false || repoCheck?.error ? "np-field-error" : "np-field-help"}>
                      {!repoNameValid
                        ? "Letters, digits, '-', '.', '_' (up to 100)."
                        : repoCheck?.name !== repoName || repoCheck?.checking
                          ? "Checking…"
                          : repoCheck?.error
                            ? repoCheck.error
                            : repoCheck?.available
                              ? "Available"
                              : "You already have a repository with this name."}
                    </span>
                  </label>
                  <div className="np-segments" role="radiogroup" aria-label="Visibility">
                    {[
                      [true, "Private"],
                      [false, "Public"],
                    ].map(([value, label]) => (
                      <label key={label} className={`np-segment${github.private === value ? " is-selected" : ""}`}>
                        <input type="radio" name="visibility" checked={github.private === value} onChange={() => setGithub((g) => ({ ...g, private: value }))} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="np-muted">The starter files are pushed to the new repository as the first commit; the project's GitHub link opens it.</p>
                </div>
              )}
            </fieldset>
          </>
        )}

        {step === 5 && (
          <>
            <h2>Review</h2>
            <dl className="np-summary">
              <dt>Kind</dt>
              <dd>
                <BrandIcon name={kind.icon} label={kind.name} size={16} /> {kind.name}
              </dd>
              <dt>Type</dt>
              <dd>
                <BrandIcon name={variant.icon} label={variant.name} size={16} /> {variant.name}
                {variant.options.map((o) => ` · ${o.values.find((x) => x.id === options[o.id])?.label}`).join("")}
              </dd>
              <dt>Dependencies</dt>
              <dd>{dependencies.length ? dependencies.map((id) => deps.find((d) => d.id === id)?.name ?? id).join(", ") : "None"}</dd>
              {variant.details.map((f) =>
                details[f.id] ? (
                  <FragmentRow key={f.id} label={f.label} value={details[f.id]} />
                ) : null
              )}
              <dt>Git</dt>
              <dd>{git ? "A repository on main with a first commit" : "No git repository"}</dd>
              <dt>GitHub</dt>
              <dd>
                {github.answer === "yes" ? (
                  <>
                    <BrandIcon name="SiGithub" label="GitHub" size={16} /> {githubStatus?.login}/{repoName} ({github.private ? "private" : "public"}), created and pushed
                  </>
                ) : (
                  "No repository"
                )}
              </dd>
            </dl>
            <h3 className="np-files-title">Files{preview ? ` (${preview.files.length})` : ""}</h3>
            {!preview ? <p className="np-muted">Preparing the file list…</p> : <FileList files={preview.files} />}
          </>
        )}
      </section>

      {error && !error.field?.startsWith("details.") && (
        <p className="np-error" role="alert">
          {error.message}
        </p>
      )}
      {step === 5 && !canCreate && <p className="np-note">{NO_FOLDERS_NOTE} Creating a project needs Chrome or Edge on a computer.</p>}

      <footer className="np-foot">
        <button type="button" className="np-btn" onClick={step === 0 ? onCancel : () => go(step - 1)} disabled={Boolean(busy)}>
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {busy && <span className="np-muted np-busy">{busy}</span>}
        {step < 5 ? (
          <button type="button" className="np-btn np-btn-primary" onClick={() => go(step + 1)} disabled={!stepValid[step]}>
            Next
          </button>
        ) : (
          <button type="button" className="np-btn np-btn-primary" onClick={create} disabled={!preview || Boolean(busy) || !canCreate} title={canCreate ? "Choose where the project folder goes" : NO_FOLDERS_NOTE}>
            Create project
          </button>
        )}
      </footer>
    </div>
  );
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

function FragmentRow({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** The generated files as an indented tree, folders first. */
function FileList({ files }) {
  const tree = {};
  for (const [path, size] of files) {
    const parts = path.split("/");
    let node = tree;
    for (const dir of parts.slice(0, -1)) node = node[`${dir}/`] ??= {};
    node[parts.at(-1)] = size;
  }
  const rows = [];
  const walk = (node, depth) => {
    const isDir = (v) => typeof v === "object";
    const entries = Object.entries(node).sort(([a, av], [b, bv]) => isDir(bv) - isDir(av) || a.localeCompare(b));
    for (const [name, v] of entries) {
      rows.push(
        <li key={`${depth}:${rows.length}:${name}`} style={{ paddingLeft: depth * 16 }} className={isDir(v) ? "np-file-dir" : "np-file"}>
          <span>{name}</span>
          {!isDir(v) && <span className="np-muted">{formatBytes(v)}</span>}
        </li>
      );
      if (isDir(v)) walk(v, depth + 1);
    }
  };
  walk(tree, 0);
  return <ul className="np-files">{rows}</ul>;
}
