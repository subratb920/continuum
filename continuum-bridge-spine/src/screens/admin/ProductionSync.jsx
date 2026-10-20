import { useState } from "react";
import { adminApi, createSyncCode } from "../../api";
import "./admin.css";

const TARGET_KEY = "continuum.syncTarget";
const DEFAULT_TARGET = "https://api.continuum-console.one";
const readTarget = () => {
  try {
    return localStorage.getItem(TARGET_KEY) || DEFAULT_TARGET;
  } catch {
    return DEFAULT_TARGET;
  }
};

const PART = { continuum: "Continuum", brain: "Brain", deploy: "Continuum Deploy" };
const words = (k) => k.replace(/^brain_/, "").replace(/_/g, " ");

/** Records per part and kind: a number (Preview) or { added, kept, refused, sameName } (the report). */
function Counts({ data }) {
  const parts = Object.entries(PART).filter(([k]) => data?.[k]);
  if (!parts.length) return null;
  return (
    <div className="sync-counts">
      {parts.map(([k, label]) => (
        <table key={k} className="admin-table sync-table">
          <caption>{label}</caption>
          <tbody>
            {Object.entries(data[k]).map(([kind, v]) => (
              <tr key={kind}>
                <td>{words(kind)}</td>
                {typeof v === "number" ? (
                  <td className="sync-n">{v}</td>
                ) : (
                  <td className="sync-n">
                    {v.added} added
                    {v.kept ? ` · ${v.kept} already there` : ""}
                    {v.sameName ? ` · ${v.sameName} kept production's (same name)` : ""}
                    {v.refused ? ` · ${v.refused} refused` : ""}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

/**
 * Production sync (Admin): your account's records from this Continuum (and
 * its brain and Continuum Deploy) added into production, under the account
 * you sign in to there. Production keeps everything it has; nothing is
 * changed or deleted. On production: create a sync code; here: paste it,
 * Preview, Merge.
 */
export default function ProductionSync() {
  const [target, setTarget] = useState(readTarget);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [mine, setMine] = useState(null); // a code created here: { code, expiresAt }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function run(what, fn) {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.message || "That didn't work.");
    }
    setBusy("");
  }

  const saveTarget = (v) => {
    setTarget(v);
    try {
      localStorage.setItem(TARGET_KEY, v);
    } catch {
      // only remembered while the page is open
    }
  };

  return (
    <section aria-label="Production sync" className="sync">
      <header className="admin-head">
        <h2>Production sync</h2>
        <span className="admin-muted">Your account's records from here, added into production. Production keeps everything it has; nothing there is changed or deleted.</span>
      </header>

      <div className="sync-card">
        <h3>Send from here to production</h3>
        <ol className="sync-steps">
          <li>On production, open Admin → Production sync (or Profile → Integrations) while signed in to the account that should get your records, and press Create a sync code.</li>
          <li>Paste the code below, Preview, then Merge.</li>
        </ol>
        <label className="sync-field">
          Production's API
          <input value={target} onChange={(e) => saveTarget(e.target.value.trim())} spellCheck={false} />
        </label>
        <label className="sync-field">
          Sync code from production
          <input value={code} onChange={(e) => setCode(e.target.value.trim())} spellCheck={false} autoComplete="off" placeholder="Valid 10 minutes, once" />
        </label>
        <div className="sync-actions">
          <button type="button" className="admin-btn" disabled={!!busy} onClick={() => run("preview", async () => setPreview(await adminApi.syncPreview()))}>
            {busy === "preview" ? "Reading…" : "Preview"}
          </button>
          {!confirm ? (
            <button type="button" className="admin-btn is-primary" disabled={!!busy || !code || !target} onClick={() => setConfirm(true)}>
              Merge into production…
            </button>
          ) : (
            <>
              <span className="admin-muted">Add your records to production now?</span>
              <button type="button" className="admin-btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn is-primary"
                disabled={!!busy}
                onClick={() =>
                  run("push", async () => {
                    setConfirm(false);
                    setResult(await adminApi.syncPush(target, code));
                    setCode("");
                  })
                }
              >
                {busy === "push" ? "Merging…" : "Yes, merge"}
              </button>
            </>
          )}
        </div>
        {preview && (
          <>
            <p className="admin-muted">Would send:</p>
            <Counts data={preview} />
            {preview.notes?.map((n) => (
              <p key={n} className="admin-muted">
                {n}
              </p>
            ))}
          </>
        )}
        {result && (
          <div className="sync-result">
            <p>
              ✓ Merged into production{result.report?.account ? ` (account ${result.report.account})` : ""}.
            </p>
            <Counts data={result.report} />
            {[...(result.sent?.notes ?? []), ...(result.report?.notes ?? [])].map((n) => (
              <p key={n} className="admin-muted">
                {n}
              </p>
            ))}
            {result.report?.deploy && <p className="admin-muted">On production's Continuum Deploy, press Reconnect once on each Google Cloud and Railway connection: their saved access is sealed with this Continuum's key.</p>}
          </div>
        )}
      </div>

      <div className="sync-card">
        <h3>Receive into this Continuum</h3>
        <p className="admin-muted">A code for the account you're signed in to here, for another Continuum to send its records to it.</p>
        <button type="button" className="admin-btn" disabled={!!busy} onClick={() => run("code", async () => setMine(await createSyncCode()))}>
          {busy === "code" ? "Creating…" : "Create a sync code"}
        </button>
        {mine && (
          <p className="sync-code">
            <code>{mine.code}</code>{" "}
            <button type="button" className="admin-link" onClick={() => navigator.clipboard?.writeText(mine.code)}>
              Copy
            </button>{" "}
            <span className="admin-muted">valid until {new Date(mine.expiresAt).toLocaleTimeString()}, once</span>
          </p>
        )}
      </div>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
