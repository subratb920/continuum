import { useState } from "react";
import "./brain.css";

const SIZE_LABEL = { small: "Small", standard: "Standard", large: "Large" };

/**
 * An organization workspace's shared policy: which models its agents may run,
 * the largest agent size, and how many agents at once. Owners and admins edit
 * it; everyone else sees it read-only. Shown only in an org space (a personal
 * space has no shared policy). Talks to the brain through the model settings hook.
 */
export default function WorkspacePolicy({ models }) {
  const { list, allowedModels, maxAgentSize, concurrencyCap, sizeNames, space, canManage, save } = models;
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState([]);
  const [maxSize, setMaxSize] = useState("");
  const [cap, setCap] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  // Only an organization has a shared policy; a personal space is governed by its owner alone.
  if (space?.kind !== "org") return null;

  const sizes = sizeNames?.length ? sizeNames : ["small", "standard", "large"];
  const modelList = list?.models ?? [];

  const begin = () => {
    setAllowed(allowedModels ?? []);
    setMaxSize(maxAgentSize ?? "");
    setCap(concurrencyCap != null ? String(concurrencyCap) : "");
    setMsg(null);
    setOpen(true);
  };
  const toggle = (id) => setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await save({ allowedModels: allowed.length ? allowed : null, maxAgentSize: maxSize || null, concurrencyCap: cap.trim() ? Number(cap) : null });
      setMsg({ ok: true, text: "Workspace policy saved." });
      setOpen(false);
    } catch (err) {
      setMsg({ ok: false, text: err.message || "That couldn't be saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-policy" aria-label="Workspace policy">
      <h4 className="workspace-policy-title">Workspace policy</h4>
      {!open && (
        <dl className="workspace-policy-summary">
          <dt>Models</dt>
          <dd>{allowedModels?.length ? `${allowedModels.length} allowed` : "Every model"}</dd>
          <dt>Largest agent</dt>
          <dd>{maxAgentSize ? SIZE_LABEL[maxAgentSize] ?? maxAgentSize : "No cap"}</dd>
          <dt>Most at once</dt>
          <dd>{concurrencyCap ?? "Server default"}</dd>
        </dl>
      )}
      {!open && canManage && (
        <button type="button" className="brain-btn" onClick={begin}>
          Edit policy…
        </button>
      )}
      {!open && !canManage && <p className="brain-hint">Your organization's owners and admins set these for everyone.</p>}
      {open && (
        <form className="model-settings-form" onSubmit={submit}>
          <fieldset className="model-modes" disabled={saving}>
            <legend>Allowed models</legend>
            <p className="brain-hint">None ticked: every model is allowed.</p>
            {modelList.map((m) => (
              <label key={m.id} className="model-mode">
                <input type="checkbox" checked={allowed.includes(m.id)} onChange={() => toggle(m.id)} disabled={m.tools === false} />
                <span className="model-mode-name brain-mono">{m.id}</span>
                {m.tools === false && <span className="brain-hint">no tools</span>}
              </label>
            ))}
          </fieldset>
          <label className="workspace-policy-field">
            Largest agent size
            <select value={maxSize} onChange={(e) => setMaxSize(e.target.value)} disabled={saving}>
              <option value="">No cap (any size)</option>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {SIZE_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <label className="workspace-policy-field">
            Most agents at once
            <input type="number" min="1" max="1000" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Server default" disabled={saving} />
          </label>
          <div className="agent-spawn-actions">
            <button type="button" className="brain-btn" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="brain-btn is-primary" disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          </div>
        </form>
      )}
      {msg && (
        <p className={msg.ok ? "brain-hint" : "model-settings-error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
