import { useEffect, useState } from "react";
import { ModelSelect } from "./ModelSettings";
import "./brain.css";
import "./ModelPicker.css";

const MODE_LABEL = { fast: "Fast", thorough: "Thorough" };
const TOOLS_LABEL = { lean: "Lean", full: "Full" };
const TIER_HINT = { small: "Routine, mechanical work", standard: "Ordinary coding", strong: "Hard reasoning" };
const BUDGET_LABEL = { off: "No cap", ok: "On track", warn: "Near cap", exceeded: "Over cap" };
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** v, or "" for the default option, from a model value that may be null. */
const sel = (v) => v ?? "";

/**
 * The compact model picker on the back of the "Right now" card: the brain's
 * model and the workers' model (one select each; the same value keeps the old
 * one-model behaviour), with an Expand button that opens the rest below —
 * per-tier worker models, speed and tools — pushing the cards under it down.
 * Older brains that don't split models fall back to a single model select.
 */
export default function ModelPicker({ models }) {
  const { available, canSplit, list, settings, error, chosen, brainModel, workerModel, defaultModel, defaultBrainModel, defaultWorkerModel, tiers, tierNames, autoRoute, budget, mode, modes, tools, toolsets, locked, changeable, refresh, save } = models;

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(null); // built from settings on open
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }

  // Start (and reset) the draft from the saved settings whenever they change
  useEffect(() => {
    if (!settings) return;
    setDraft({
      brain: sel(canSplit ? brainModel : chosen),
      worker: sel(canSplit ? workerModel : chosen),
      tiers: { small: sel(tiers.small), standard: sel(tiers.standard), strong: sel(tiers.strong) },
      mode: mode ?? null,
      tools: tools ?? null,
      budgetCap: budget?.userCapUsd != null ? String(budget.userCapUsd) : "",
    });
  }, [settings, canSplit, brainModel, workerModel, chosen, tiers.small, tiers.standard, tiers.strong, mode, tools, budget?.userCapUsd]);

  if (!available) return <p className="brain-hint mp-empty">The model settings aren't available here.</p>;
  if (!draft) return <p className="brain-hint mp-empty">Loading the models…</p>;

  const disabled = saving || !changeable;

  // What changed, in the shape the API takes (model when the server doesn't split; brain/worker when it does)
  function changes() {
    const c = {};
    if (canSplit) {
      if (draft.brain !== sel(brainModel)) c.brainModel = draft.brain || null;
      if (draft.worker !== sel(workerModel)) c.workerModel = draft.worker || null;
      const t = {};
      for (const k of tierNames) if (draft.tiers[k] !== sel(tiers[k])) t[k] = draft.tiers[k] || null;
      if (Object.keys(t).length) c.tiers = t;
    } else if (draft.brain !== sel(chosen)) {
      c.model = draft.brain || null;
    }
    if (draft.mode && draft.mode !== mode) c.mode = draft.mode;
    if (draft.tools && draft.tools !== tools) c.tools = draft.tools;
    // The spend cap: blank clears it back to the default; a number sets it (0 = no limit)
    const capStr = (draft.budgetCap ?? "").trim();
    const curCap = budget?.userCapUsd ?? null;
    if (capStr === "") {
      if (curCap !== null) c.budgetCapUsd = null;
    } else {
      const n = Number(capStr);
      if (Number.isFinite(n) && n >= 0 && n !== curCap) c.budgetCapUsd = n;
    }
    return c;
  }
  const dirty = Object.keys(changes()).length > 0;

  async function submit(e) {
    e.preventDefault();
    const c = changes();
    if (!Object.keys(c).length) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await save(c);
      setMessage({ ok: true, text: r.stopped ? `Saved. ${r.stopped} idle ${r.stopped === 1 ? "agent was" : "agents were"} stopped so each starts on the new model.` : "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err.message || "That couldn't be saved." });
    } finally {
      setSaving(false);
    }
  }

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setTier = (k, v) => setDraft((d) => ({ ...d, tiers: { ...d.tiers, [k]: v } }));

  // Automatic routing is a toggle: it saves on its own (nothing running changes)
  async function toggleAuto(on) {
    setSaving(true);
    setMessage(null);
    try {
      await save({ autoRoute: on });
      setMessage({ ok: true, text: on ? "Continuum will choose each worker's model from your prompt and goals." : "Workers use your workers model; Continuum won't vary it." });
    } catch (err) {
      setMessage({ ok: false, text: err.message || "That couldn't be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mp" onSubmit={submit}>
      {canSplit && (
        <label className="mp-auto" title="Continuum picks each worker's tier from your prompt and the session goals">
          <input type="checkbox" checked={autoRoute !== false} disabled={saving || !changeable} onChange={(e) => toggleAuto(e.target.checked)} />
          <span className="mp-auto-text">Auto‑route<span className="brain-hint"> · Continuum picks the model per task</span></span>
        </label>
      )}
      {canSplit ? (
        <>
          <label className="mp-field">
            <span className="mp-label">Brain</span>
            <ModelSelect list={list} value={draft.brain} onChange={(v) => set({ brain: v })} defaultLabel={`Default (${defaultBrainModel ?? "…"})`} label="The brain's model" disabled={disabled} />
          </label>
          <label className="mp-field">
            <span className="mp-label">Workers</span>
            <ModelSelect list={list} value={draft.worker} onChange={(v) => set({ worker: v })} defaultLabel={`Default (${defaultWorkerModel ?? "…"})`} label="The workers' model" disabled={disabled} />
          </label>
        </>
      ) : (
        <label className="mp-field">
          <span className="mp-label">Model</span>
          <ModelSelect list={list} value={draft.brain} onChange={(v) => set({ brain: v, worker: v })} defaultLabel={`Default (${defaultModel ?? "…"})`} label="The model every agent runs on" disabled={disabled} />
        </label>
      )}

      {/* The rest opens below, pushing the cards under it down */}
      <div className={`mp-more${expanded ? " is-open" : ""}`}>
        <div className="mp-more-inner">
          {canSplit && tierNames.length > 0 && (
            <fieldset className="mp-tiers" disabled={disabled}>
              <legend>Worker tiers <span className="brain-hint">· the brain picks one per task (optional)</span></legend>
              {tierNames.map((k) => (
                <label key={k} className="mp-field mp-tier">
                  <span className="mp-label">{k[0].toUpperCase() + k.slice(1)}<span className="brain-hint"> · {TIER_HINT[k] ?? ""}</span></span>
                  <ModelSelect list={list} value={draft.tiers[k]} onChange={(v) => setTier(k, v)} defaultLabel="Use the workers' model" label={`The ${k} tier's model`} disabled={disabled} />
                </label>
              ))}
            </fieldset>
          )}
          {modes.length > 0 && (
            <fieldset className="mp-choices" disabled={disabled}>
              <legend>Speed</legend>
              <div className="mp-segs">
                {modes.map((m) => (
                  <label key={m.id} className={`mp-seg${draft.mode === m.id ? " is-on" : ""}`} title={m.words}>
                    <input type="radio" name="mp-speed" value={m.id} checked={draft.mode === m.id} onChange={() => set({ mode: m.id })} />
                    {MODE_LABEL[m.id] ?? m.id}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {toolsets.length > 0 && (
            <fieldset className="mp-choices" disabled={disabled}>
              <legend>Tools (workers)</legend>
              <div className="mp-segs">
                {toolsets.map((t) => (
                  <label key={t.id} className={`mp-seg${draft.tools === t.id ? " is-on" : ""}`} title={t.words}>
                    <input type="radio" name="mp-tools" value={t.id} checked={draft.tools === t.id} onChange={() => set({ tools: t.id })} />
                    {TOOLS_LABEL[t.id] ?? t.id}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {budget && (
            <fieldset className="mp-budget" disabled={disabled}>
              <legend>Budget <span className="brain-hint">· cloud models, this {budget.period === "daily" ? "day" : "month"}</span></legend>
              <div className="mp-budget-row">
                <span className="mp-budget-spent">{money(budget.periodCostUsd)}{budget.capUsd > 0 ? ` of ${money(budget.capUsd)}` : ""}</span>
                <span className={`mp-budget-state is-${budget.state}`}>{BUDGET_LABEL[budget.state] ?? budget.state}</span>
              </div>
              {budget.capUsd > 0 && (
                <span className="mp-budget-bar" aria-hidden="true">
                  <span className={`is-${budget.state}`} style={{ width: `${Math.min(100, (budget.periodCostUsd / budget.capUsd) * 100)}%` }} />
                </span>
              )}
              <label className="mp-field">
                <span className="mp-label">Your cap, USD <span className="brain-hint">· blank = default, 0 = no limit</span></span>
                <input className="mp-budget-input" type="number" min="0" step="1" inputMode="decimal" placeholder="e.g. 20" value={draft.budgetCap ?? ""} onChange={(e) => set({ budgetCap: e.target.value })} disabled={disabled} />
              </label>
              <p className="brain-hint">Over the cap, new cloud‑model agents pause; local models stay free and running agents finish.</p>
            </fieldset>
          )}
        </div>
      </div>

      {locked && <p className="brain-hint mp-locked">{locked}</p>}
      {error && <p className="model-settings-error" role="alert">{error}</p>}
      {message && <p className={message.ok ? "brain-hint" : "model-settings-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}

      <div className="mp-actions">
        <button type="button" className="mp-expand" onClick={() => { setExpanded((v) => !v); if (!expanded) refresh?.(); }} aria-expanded={expanded}>
          {expanded ? "Less" : canSplit ? "Tiers, speed & tools" : "Speed & tools"}
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className={`mp-chevron${expanded ? " is-up" : ""}`}><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="submit" className="brain-btn is-primary mp-save" disabled={disabled || !dirty}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
