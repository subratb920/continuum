import { useEffect, useState } from "react";
import { dataApi } from "../../data/dataApi";
import { bytes } from "./dataDisplay";
import "./data.css";

/**
 * Data settings (left, Settings tab): the tokens some sources need (sealed
 * by Continuum; only their last four characters are shown back) and how much
 * of your data space is used.
 */
const HELP = {
  kaggle: "On kaggle.com: your profile → Settings → API → Create New Token. Paste the kaggle.json file's text, or username:key.",
  huggingface: "On huggingface.co: Settings → Access Tokens → a token that can read. It starts with hf_.",
};

export default function DataSettings() {
  const [state, setState] = useState(null);
  const [me, setMe] = useState(null);
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all([dataApi.credentials(), dataApi.me()])
      .then(([c, m]) => (setState(c), setMe(m)))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function save(kind) {
    setError(null);
    try {
      await dataApi.saveCredential(kind, value);
      setEditing(null);
      setValue("");
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const used = me?.usage?.bytes ?? 0;
  const limit = me?.limits?.diskBytes ?? 0;
  return (
    <div className="data-settings">
      <section>
        <h3 className="data-sub">Your data space</h3>
        {me && (
          <>
            <div className="data-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Data space used">
              <span style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }} />
            </div>
            <p className="data-hint">{bytes(used)} of {bytes(limit)} used · {me.usage.runsActive} running now</p>
          </>
        )}
      </section>
      <section>
        <h3 className="data-sub">Tokens for sources</h3>
        {state && !state.canSave && <p className="data-hint">Saving tokens isn't switched on here (DATA_SECRET_KEY).</p>}
        <ul className="data-tokens">
          {state?.credentials.map((c) => (
            <li key={c.kind}>
              <div className="data-token-top">
                <strong>{c.label}</strong>
                <span className="data-hint">{c.saved ? `Saved · ends in ${c.hint}` : "Not saved"}</span>
              </div>
              {editing === c.kind ? (
                <div className="data-token-form">
                  <p className="data-hint">{HELP[c.kind]}</p>
                  <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${c.label} token`} autoComplete="off" spellCheck={false} />
                  <div className="data-actions">
                    <button type="button" className="data-btn is-primary" disabled={!value.trim()} onClick={() => save(c.kind)}>Save</button>
                    <button type="button" className="data-btn" onClick={() => (setEditing(null), setValue(""))}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="data-actions">
                  <button type="button" className="data-btn" disabled={!state.canSave} onClick={() => (setEditing(c.kind), setValue(""), setError(null))}>{c.saved ? "Replace" : "Add"}</button>
                  {c.saved && (
                    <button type="button" className="data-btn is-danger" onClick={() => dataApi.removeCredential(c.kind).then(load)}>Remove</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="data-error">{error}</p>}
      </section>
    </div>
  );
}
