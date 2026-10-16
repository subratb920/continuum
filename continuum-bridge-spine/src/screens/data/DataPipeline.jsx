import { useEffect, useId, useState } from "react";
import { useData } from "../../data/dataContext";
import { dataApi } from "../../data/dataApi";
import "./data.css";

/**
 * Clean-up (centre, on a dataset): the pipeline of steps to run on the
 * version shown. It starts from what the profile noticed ("Suggested") or a
 * template; steps can be added, moved, switched off and set up. Each step's
 * settings form comes from the engine's step catalogue.
 */
export default function DataPipeline({ dataset, version }) {
  const data = useData();
  const draft = data.drafts[dataset.id] ?? { open: false, steps: [] };
  const catalog = data.catalog?.steps ?? null;
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState("");
  const modality = version?.modality;
  const columns = (version?.schema ?? []).filter((c) => !c.name.startsWith("_")).map((c) => c.name);

  useEffect(() => {
    dataApi.templates().then(setTemplates).catch(() => {});
  }, []);

  const setSteps = (steps) => data.setDraft(dataset.id, { steps });
  const open = async () => {
    data.setDraft(dataset.id, { open: true });
    if (!draft.steps.length) await loadSuggested();
  };
  async function loadSuggested() {
    try {
      const steps = await dataApi.suggestedSteps(dataset.id);
      setSteps(steps.map((s) => ({ ...s, enabled: true })));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!version || !catalog) return null;
  const hasLabels = Boolean(version.labels?.length);
  const available = Object.entries(catalog).filter(([, s]) => s.modalities.includes(modality) && (!s.needsLabel || hasLabels));

  if (!draft.open) {
    return (
      <section className="data-card data-pipeline-closed">
        <div>
          <h2 className="data-card-title">Clean up</h2>
          <p className="data-hint">Remove copies, fix gaps, split for testing and check quality. Each step makes a new version, so nothing is lost.</p>
        </div>
        <button type="button" className="data-btn is-primary" onClick={open}>Clean up this data</button>
      </section>
    );
  }

  const move = (i, d) => {
    const s = [...draft.steps];
    [s[i], s[i + d]] = [s[i + d], s[i]];
    setSteps(s);
  };
  const update = (i, patch) => setSteps(draft.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const setParam = (i, name, value) => update(i, { params: { ...draft.steps[i].params, [name]: value } });
  const enabled = draft.steps.filter((s) => s.enabled !== false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await data.runPipeline(dataset, enabled.map(({ op, params }) => ({ op, params: clean(params) })), version.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-card data-pipeline">
      <div className="data-card-head">
        <h2 className="data-card-title">Clean up · from version {version.number}</h2>
        <div className="data-actions">
          <select
            aria-label="Start from"
            value=""
            onChange={async (e) => {
              const v = e.target.value;
              if (v === "suggested") await loadSuggested();
              else {
                const t = templates.find((x) => x.id === v);
                if (t) setSteps(t.steps.map((s) => ({ ...s, enabled: true })));
              }
            }}
          >
            <option value="">Start from…</option>
            <option value="suggested">Suggested for this data</option>
            {templates.filter((t) => t.modalities.includes(modality)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="button" className="data-btn" onClick={() => data.setDraft(dataset.id, { open: false })}>Close</button>
        </div>
      </div>

      {!draft.steps.length && <p className="data-hint">No steps yet. Start from a suggestion, or add a step below.</p>}
      <ol className="data-pipe-steps">
        {draft.steps.map((s, i) => {
          const spec = catalog[s.op];
          if (!spec) return null;
          return (
            <li key={`${s.op}-${i}`} className={`data-pipe-step${s.enabled === false ? " is-off" : ""}`}>
              <div className="data-pipe-head">
                <span className="data-step-mark" aria-hidden="true">{i + 1}</span>
                <div className="data-pipe-title">
                  <strong>{spec.label}</strong>
                  <span className="data-hint">{spec.hint}</span>
                </div>
                <div className="data-pipe-tools">
                  <label className="data-toggle" title="Switch this step on or off">
                    <input type="checkbox" checked={s.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} /> On
                  </label>
                  <button type="button" className="data-icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${spec.label} up`}>↑</button>
                  <button type="button" className="data-icon-btn" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${spec.label} down`}>↓</button>
                  <button type="button" className="data-icon-btn" onClick={() => setSteps(draft.steps.filter((_, k) => k !== i))} aria-label={`Remove ${spec.label}`}>✕</button>
                </div>
              </div>
              {s.enabled !== false && (
                <div className="data-pipe-form">
                  {Object.entries(spec.params)
                    .filter(([, p]) => (!p.modalities || p.modalities.includes(modality)) && shown(p, s.params, spec))
                    .map(([name, p]) => (
                      <Setting key={name} name={name} spec={p} value={s.params?.[name] ?? p.default} columns={columns} onChange={(v) => setParam(i, name, v)} />
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="data-actions">
        <select aria-label="Add a step" value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a step…</option>
          {available.map(([op, spec]) => (
            <option key={op} value={op}>{spec.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="data-btn"
          disabled={!adding}
          onClick={() => {
            const at = draft.steps.findIndex((s) => s.op === "validate");
            const step = { op: adding, params: {}, enabled: true };
            setSteps(at >= 0 && adding !== "validate" ? [...draft.steps.slice(0, at), step, ...draft.steps.slice(at)] : [...draft.steps, step]);
            setAdding("");
          }}
        >
          Add
        </button>
        <span className="data-spacer" />
        <button type="button" className="data-btn is-primary" disabled={busy || !enabled.length || dataset.state === "building"} onClick={run}>
          {busy ? "Starting…" : `Run ${enabled.length} ${enabled.length === 1 ? "step" : "steps"}`}
        </button>
      </div>
      {error && <p className="data-error">{error}</p>}
    </section>
  );
}

/** A setting is shown unless its showIf names another setting's value that doesn't match. */
function shown(p, params, spec) {
  if (!p.showIf) return true;
  return Object.entries(p.showIf).every(([k, want]) => {
    const cur = params?.[k] ?? spec.params[k]?.default;
    return Array.isArray(want) ? want.includes(cur) : cur === want;
  });
}

/** Empty settings are left out, so the engine fills in its defaults. */
function clean(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));
}

function Setting({ name, spec, value, columns, onChange }) {
  const id = `set-${name}-${useId()}`;
  const label = <label htmlFor={id}>{spec.label}</label>;
  switch (spec.kind) {
    case "boolean":
      return (
        <label className="data-toggle data-set">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> {spec.label}
        </label>
      );
    case "enum":
      return (
        <div className="data-set">
          {label}
          <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            {spec.choices.map((c) => (
              <option key={c} value={c}>{spec.labels?.[c] ?? c}</option>
            ))}
          </select>
        </div>
      );
    case "number":
    case "integer":
      return (
        <div className="data-set">
          {label}
          <input
            id={id}
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? (spec.kind === "integer" ? 1 : 0.01)}
            value={value ?? ""}
            placeholder="—"
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
      );
    case "ratios": {
      const r = value ?? [0.8, 0.1, 0.1];
      const pct = r.map((x) => Math.round(x * 100));
      return (
        <div className="data-set">
          <span>{spec.label}</span>
          <div className="data-ratios">
            {["Train", "Validation", "Test"].map((n, k) => (
              <label key={n}>
                {n}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={pct[k]}
                  onChange={(e) => {
                    const next = [...pct];
                    next[k] = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    // the last share takes up the difference, so they add to 100
                    if (k < 2) next[2] = Math.max(0, 100 - next[0] - next[1]);
                    onChange(next.map((x) => x / 100));
                  }}
                />
                %
              </label>
            ))}
          </div>
          {pct[0] + pct[1] + pct[2] !== 100 && <span className="data-error">The three shares must add up to 100%.</span>}
        </div>
      );
    }
    case "column":
      return (
        <div className="data-set">
          {label}
          <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">Choose…</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      );
    case "enum-list":
      return (
        <div className="data-set">
          <span>{spec.label}</span>
          <div className="data-chips">
            {spec.choices.map((c) => {
              const on = (value ?? []).includes(c);
              return (
                <button key={c} type="button" className={`data-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== c) : [...(value ?? []), c])}>
                  {spec.labels?.[c] ?? c}
                </button>
              );
            })}
          </div>
        </div>
      );
    case "words":
      return (
        <div className="data-set">
          {label}
          <input id={id} type="text" value={Array.isArray(value) ? value.join(", ") : value ?? ""} placeholder="word, another word" maxLength={2000} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "columns":
      return (
        <div className="data-set">
          <span>{spec.label}</span>
          <div className="data-chips">
            {columns.map((c) => {
              const on = (value ?? []).includes(c);
              return (
                <button key={c} type="button" className={`data-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== c) : [...(value ?? []), c])}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      );
    default:
      return (
        <div className="data-set">
          {label}
          <input id={id} type="text" value={value ?? ""} placeholder={spec.placeholder} maxLength={500} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}
