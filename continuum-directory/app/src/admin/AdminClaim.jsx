import { useState } from "react";
import { adminApi } from "../api";
import { useAuth } from "../auth";
import "./admin.css";

/**
 * There's no admin yet: the first one enters the one-time setup code that
 * continuum-api wrote to its own log when it started. Once claimed, the
 * Admin area opens; nobody else can claim it after.
 */
export default function AdminClaim() {
  const { reloadAccess } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminApi.claim(code.trim());
      await reloadAccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-claim">
      <form className="admin-claim-card" onSubmit={submit}>
        <h2>Set up the first admin</h2>
        <p className="admin-muted">There's no admin yet. Enter the one-time setup code from continuum-api's log to become the first one.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" aria-label="Setup code" autoComplete="off" spellCheck={false} autoFocus />
        <button type="submit" className="admin-btn is-primary" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length < 12}>
          {busy ? "Checking…" : "Become admin"}
        </button>
        {error && <p className="admin-error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
