import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../api";
import "./admin.css";

/** The operator ceilings, as number fields. `global` adds the cluster-wide total. */
const NUM_FIELDS = [
  ["perUserAgents", "Max agents / user"],
  ["maxCpu", "Max CPU / agent (cores)"],
  ["maxMemoryGb", "Max memory / agent (GB)"],
  ["maxGpu", "Max GPUs / server"],
  ["budgetUsd", "Budget cap ($)"],
];

/** limits object → string-valued form (blank = no limit). */
function toForm(limits = {}) {
  const f = {};
  for (const [k] of [["totalAgents"], ...NUM_FIELDS]) f[k] = limits[k] == null ? "" : String(limits[k]);
  f.blockSelfHosted = limits.allowSelfHosted === false;
  return f;
}
/** form → limits object (blank number = omit; omit allowSelfHosted unless blocking). */
function fromForm(form, { global }) {
  const out = {};
  const keys = global ? ["totalAgents", ...NUM_FIELDS.map((f) => f[0])] : NUM_FIELDS.map((f) => f[0]);
  for (const k of keys) {
    const v = String(form[k] ?? "").trim();
    if (v !== "") out[k] = Number(v);
  }
  if (global) out.allowSelfHosted = !form.blockSelfHosted;
  else if (form.blockSelfHosted) out.allowSelfHosted = false;
  return out;
}

const summary = (l = {}) => {
  const bits = [];
  if (l.perUserAgents != null) bits.push(`${l.perUserAgents} agents`);
  if (l.maxCpu != null) bits.push(`${l.maxCpu} CPU`);
  if (l.maxMemoryGb != null) bits.push(`${l.maxMemoryGb} GB`);
  if (l.maxGpu != null) bits.push(`${l.maxGpu} GPU`);
  if (l.budgetUsd != null) bits.push(`$${l.budgetUsd}`);
  if (l.allowSelfHosted === false) bits.push("no self-hosted");
  return bits.length ? bits.join(" · ") : "no limits";
};

/** A reusable grid of the ceiling inputs. */
function LimitsFields({ form, set, global, disabled }) {
  const fields = global ? [["totalAgents", "Max agents (global)"], ...NUM_FIELDS] : NUM_FIELDS;
  return (
    <div className="brain-limits-grid">
      {fields.map(([key, label]) => (
        <label key={key} className="brain-field">
          {label}
          <input type="number" min="0" step="1" value={form[key]} placeholder="no limit" disabled={disabled} onChange={(e) => set({ ...form, [key]: e.target.value })} />
        </label>
      ))}
      <label className="brain-check">
        <input type="checkbox" checked={!!form.blockSelfHosted} disabled={disabled} onChange={(e) => set({ ...form, blockSelfHosted: e.target.checked })} />
        Block self-hosted GPU
      </label>
    </div>
  );
}

/**
 * Brain control (Admin): the operator's switch and compute ceilings for the brain,
 * globally and per user. Start/stop agents instantly, and cap agents-at-once, CPU,
 * memory, GPU, spend and self-hosted GPU. These bound whatever orgs and users choose.
 */
export default function BrainControl() {
  const [data, setData] = useState(null);
  const [names, setNames] = useState({}); // userId -> "name <email>"
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gForm, setGForm] = useState(toForm());
  const [edit, setEdit] = useState(null); // { userId, paused, form } for the per-user editor
  const [lookup, setLookup] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await adminApi.brainOverview();
      setData(d);
      setGForm(toForm(d.global.limits));
    } catch (e) {
      setErr(e.message || "Couldn't load brain control.");
    }
  }, []);

  useEffect(() => {
    // Load in promise callbacks (not a direct setState in the effect body) — both resolve asynchronously.
    adminApi.brainOverview().then((d) => { setData(d); setGForm(toForm(d.global.limits)); }, (e) => setErr(e.message || "Couldn't load brain control."));
    adminApi.users({ kind: "human" }).then((r) => setNames(Object.fromEntries((r.users ?? []).map((u) => [u.id, u.name ? `${u.name}${u.email ? ` <${u.email}>` : ""}` : u.email || u.id]))), () => {});
  }, []);

  const act = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const openUser = async (userId) => {
    setErr("");
    try {
      const u = await adminApi.brainUser(userId);
      setEdit({ userId, paused: u.paused, form: toForm(u.limits), agents: u.agents ?? [] });
    } catch (e) {
      setErr(e.message || "Couldn't load that user.");
    }
  };

  if (!data) return <p className="admin-muted">{err || "Loading…"}</p>;
  const g = data.global;
  const nameOf = (id) => names[id] || id;

  return (
    <section aria-label="Brain control" className="brain-control">
      <header className="admin-head">
        <h2>Brain control</h2>
        <span className="admin-muted">{data.totalRunning} running · {data.totalActive} active{g.paused ? " · PAUSED" : ""}</span>
      </header>
      {err && <p className="admin-error" role="alert">{err} <button type="button" className="admin-link" onClick={() => setErr("")}>Dismiss</button></p>}

      {/* ── Global controls ───────────────────────────── */}
      <div className="brain-card">
        <h3>Everything {g.paused ? <span className="brain-badge is-paused">Paused</span> : <span className="brain-badge is-live">Live</span>}</h3>
        <p className="admin-muted">A stop hard-kills every agent and every GPU model server at once (work in progress is lost; cloned repos are kept). Nothing can start again until you resume.</p>
        <div className="brain-actions">
          {g.paused ? (
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => act(() => adminApi.brainResume())}>Resume</button>
          ) : (
            <button type="button" className="admin-btn brain-danger" disabled={busy} onClick={() => act(() => adminApi.brainStopAll(), "Stop ALL agents across all users and orgs right now? Running work will be lost.")}>Emergency stop all</button>
          )}
        </div>
        <form className="brain-limits" onSubmit={(e) => { e.preventDefault(); act(() => adminApi.brainSetLimits(fromForm(gForm, { global: true }))); }}>
          <h4>Global limits <span className="admin-muted">· the ceiling for everyone (blank = no limit)</span></h4>
          <LimitsFields form={gForm} set={setGForm} global disabled={busy} />
          <button type="submit" className="admin-btn" disabled={busy}>Save global limits</button>
        </form>
      </div>

      {/* ── Per-user segregation ──────────────────────── */}
      <div className="brain-card">
        <h3>Per-user</h3>
        <p className="admin-muted">Stop, pause, or set tighter ceilings for one user. A per-user value overrides the global one when it's lower.</p>
        <form className="brain-lookup" onSubmit={(e) => { e.preventDefault(); if (/^[a-f0-9]{24}$/.test(lookup.trim())) openUser(lookup.trim()); else setErr("Enter a 24-character user id."); }}>
          <input type="text" placeholder="User id (24 hex) to manage" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button type="submit" className="admin-btn" disabled={busy}>Manage</button>
        </form>
        <table className="admin-table">
          <thead>
            <tr><th>User</th><th>Agents</th><th>Limits</th><th></th></tr>
          </thead>
          <tbody>
            {data.users.length === 0 && <tr><td colSpan="4" className="admin-muted">No active users.</td></tr>}
            {data.users.map((u) => (
              <tr key={u.userId} className={u.paused ? "is-paused" : ""}>
                <td>{nameOf(u.userId)}{u.paused ? " · paused" : ""}</td>
                <td>{u.running} / {u.active}</td>
                <td className="admin-muted">{summary(u.limits)}</td>
                <td className="brain-row-actions">
                  <button type="button" className="admin-link" disabled={busy} onClick={() => openUser(u.userId)}>Manage</button>
                  <button type="button" className="admin-link" disabled={busy} onClick={() => act(() => adminApi.brainStopUser(u.userId), `Stop all of ${nameOf(u.userId)}'s agents now?`)}>Stop</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Per-user editor ───────────────────────────── */}
      {edit && (
        <div className="brain-card brain-editor">
          <header className="admin-head">
            <h3>{nameOf(edit.userId)}</h3>
            <button type="button" className="admin-link" onClick={() => setEdit(null)}>Close</button>
          </header>
          <div className="brain-actions">
            <button type="button" className="admin-btn brain-danger" disabled={busy} onClick={() => act(() => adminApi.brainStopUser(edit.userId), `Stop all of ${nameOf(edit.userId)}'s agents now?`)}>Stop their agents</button>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => act(async () => { await adminApi.brainSetUser(edit.userId, { paused: !edit.paused }); setEdit({ ...edit, paused: !edit.paused }); })}>{edit.paused ? "Resume this user" : "Pause this user"}</button>
          </div>
          <form className="brain-limits" onSubmit={(e) => { e.preventDefault(); act(() => adminApi.brainSetUser(edit.userId, { limits: fromForm(edit.form, { global: false }) })); }}>
            <h4>This user's limits <span className="admin-muted">· blank = inherit the global ceiling</span></h4>
            <LimitsFields form={edit.form} set={(form) => setEdit({ ...edit, form })} disabled={busy} />
            <button type="submit" className="admin-btn is-primary" disabled={busy}>Save user limits</button>
          </form>
          {edit.agents?.length > 0 && <p className="admin-muted">{edit.agents.length} agent(s) running now.</p>}
        </div>
      )}
    </section>
  );
}
