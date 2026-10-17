import { useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { runningModel } from "./agentDisplay";
import "./brain.css";

const PROVIDER_LABEL = { ollama: "Ollama (this computer)", anthropic: "Claude", openai: "OpenAI", opencode: "OpenCode Zen", compat: "OpenAI-compatible" };
/** Awake and busy: the model waits until none is (and nothing waits on you). */
const AWAKE = ["queued", "starting", "working", "stopping"];

const ctx = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * A model to pick, grouped by provider; models that can't use tools are shown
 * but can't be picked (agents need tools). "" means the default, labelled.
 */
function ModelSelect({ list, value, onChange, defaultLabel, label, disabled }) {
  const models = list?.models ?? [];
  const byProvider = new Map();
  for (const m of models) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
  // A saved model no longer listed (its provider gone, a model removed) still shows, so the choice is visible
  const missing = value && !models.some((m) => m.id === value);
  return (
    <select className="model-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled}>
      <option value="">{defaultLabel}</option>
      {missing && <option value={value}>{value} (not available now)</option>}
      {[...byProvider].map(([provider, ms]) => (
        <optgroup key={provider} label={PROVIDER_LABEL[provider] ?? provider}>
          {ms.map((m) => (
            <option key={m.id} value={m.id} disabled={m.tools === false}>
              {m.name}
              {m.size ? ` · ${m.size}` : ""}
              {m.maxContext ? ` · ${ctx(m.maxContext)} context` : ""}
              {m.tools === false ? " · no tools" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** The models some agents run on now (each from the agent: the orchestrator says), or null. */
function modelsOf(agents) {
  const ms = [...new Set(agents.map(runningModel).filter(Boolean))];
  return ms.length ? ms.join(", ") : null;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Model (in the Agents pane): the one model your brain and every worker run
 * on, and what each actually runs on now (brain, workers, all running).
 * It changes only while nothing is awake and nothing waits on you; agents
 * left idle then stop, so none stays on the old model.
 */
export default function ModelSettings({ models }) {
  const brain = useBrain();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }
  const { list, settings, error, model, chosen, defaultModel, save, refresh, available } = models;
  if (!available) return null;

  // Now, from the agents themselves (live, even while replaying)
  const live = brain?.live ?? { agentList: [], pending: [] };
  const up = live.agentList.filter((a) => a.state !== "stopped" && a.state !== "failed");
  const core = up.find((a) => a.kind === "core");
  const workers = up.filter((a) => a.kind === "worker");
  const awake = up.filter((a) => AWAKE.includes(a.state));
  const idleWorkers = workers.filter((w) => w.state === "idle").length;
  const idleBrain = core?.state === "idle";
  const lockedWhy = awake.length
    ? `${count(awake.length, "agent is", "agents are")} awake. The model can change once everything is idle.`
    : live.pending.length
      ? `${count(live.pending.length, "request waits", "requests wait")} for your answer. Answer first, then change the model.`
      : settings?.locked ?? null;

  const begin = () => {
    setDraft(chosen ?? "");
    setMessage(null);
    setOpen(true);
    refresh();
  };

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const r = await save(draft || null);
      setMessage({ ok: true, text: r.stopped ? `Saved. ${count(r.stopped, "idle agent was", "idle agents were")} stopped, so every agent starts on ${r.model}.` : `Saved. Every agent now runs on ${r.model}.` });
      setOpen(false);
    } catch (err) {
      setMessage({ ok: false, text: err.message || "That model can't be used." });
    } finally {
      setSaving(false);
    }
  }

  const unset = (list?.providers ?? []).filter((p) => !p.setUp).map((p) => PROVIDER_LABEL[p.provider] ?? p.provider);
  const broken = (list?.providers ?? []).filter((p) => p.setUp && p.error);
  const asleep = (t) => <span className="model-asleep">{t}</span>;

  return (
    <section className="model-settings" aria-label="Model">
      <div className="model-settings-summary">
        <dl>
          <dt>Model</dt>
          <dd className="brain-mono" title="The one model your brain and every worker run on">{model ?? "…"}</dd>
          <dt>Brain</dt>
          <dd className="brain-mono" title="What your brain runs on now">{core ? runningModel(core) : asleep(`asleep · starts on ${model ?? "…"}`)}</dd>
          <dt>Workers</dt>
          <dd className="brain-mono" title="What your workers run on now">{modelsOf(workers) ?? asleep(`none awake · start on ${model ?? "…"}`)}</dd>
          <dt>Running</dt>
          <dd className="brain-mono" title="Every model in use now">{modelsOf(up.filter((a) => a.state !== "queued")) ?? asleep("nothing running")}</dd>
        </dl>
        {!open && (
          <button type="button" className="brain-link" onClick={begin} disabled={!!lockedWhy} title={lockedWhy ?? "Change the model every agent runs on"}>
            Change
          </button>
        )}
      </div>
      {!open && lockedWhy && <p className="brain-hint">{lockedWhy}</p>}
      {open && (
        <form className="model-settings-form" onSubmit={submit}>
          <ModelSelect list={list} value={draft} onChange={setDraft} defaultLabel={`Server default (${defaultModel ?? "…"})`} label="The model every agent runs on" disabled={!!lockedWhy || saving} />
          <p className="brain-hint">Your brain and every worker run on this one model.</p>
          {(idleBrain || idleWorkers > 0) && (
            <p className="model-settings-warning">
              Saving stops {[idleBrain && "your idle brain", idleWorkers > 0 && count(idleWorkers, "idle worker", "idle workers")].filter(Boolean).join(" and ")} so none stays on the old model. Push any worker's changes first.
            </p>
          )}
          {!list && !error && <p className="brain-hint">Loading the models…</p>}
          {list && !list.models.length && <p className="brain-hint">No models are available: no provider is set up on Continuum's side.</p>}
          {unset.length > 0 && <p className="brain-hint">Not set up here: {unset.join(", ")}. Their models appear once their key is added to Continuum's brain.</p>}
          {broken.map((p) => (
            <p key={p.provider} className="model-settings-error">{PROVIDER_LABEL[p.provider] ?? p.provider}: {p.error}</p>
          ))}
          {lockedWhy && <p className="model-settings-error" role="alert">{lockedWhy}</p>}
          {error && <p className="model-settings-error" role="alert">{error}</p>}
          <div className="agent-spawn-actions">
            <button type="button" className="brain-btn" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="brain-btn is-primary" disabled={saving || !list || !!lockedWhy || (draft || null) === chosen}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
      {message && <p className={message.ok ? "brain-hint" : "model-settings-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </section>
  );
}
