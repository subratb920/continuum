import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../api";
import { since, useAdmin } from "./adminContext";
import "./admin.css";

const TIME = { asap: "As soon as possible", morning: "Morning (9–12)", afternoon: "Afternoon (12–17)", evening: "Evening (17–20)" };
const FROM = { continuum: "Continuum", deploy: "Continuum Deploy" };

/**
 * Callback requests (Admin): who asked from Contact us (in Continuum or
 * Continuum Deploy) to be called, on which number, when, and why. New ones
 * first; mark one called once you have (or back to new).
 */
export default function Callbacks() {
  const { select } = useAdmin();
  const [status, setStatus] = useState("new");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    adminApi
      .callbacks(status)
      .then((d) => (setData(d), setError("")))
      .catch((err) => setError(err.message));
  }, [status]);
  useEffect(load, [load]);

  async function mark(r, to) {
    setBusy(r.id);
    try {
      await adminApi.markCallback(r.id, to);
      load();
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  const items = data?.items ?? [];
  return (
    <section aria-label="Callback requests">
      <header className="admin-head">
        <h2>Callback requests</h2>
        <span className="admin-muted">{data ? `${data.open} waiting for a call` : "Loading…"}</span>
        <span className="admin-check">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
            <option value="new">Waiting</option>
            <option value="called">Called</option>
            <option value="">All</option>
          </select>
        </span>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Asked</th>
              <th>Who</th>
              <th>Phone</th>
              <th>Best time</th>
              <th>What it's about</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td title={new Date(r.createdAt).toLocaleString()}>
                  {since(r.createdAt)}
                  <span className="admin-client">{FROM[r.source] ?? r.source}</span>
                </td>
                <td>
                  {r.name || "—"}
                  <span className="admin-client">
                    {r.userId ? <button type="button" className="admin-link" onClick={() => select("user", r.userId)}>{r.email ?? "their account"}</button> : r.email ?? "—"}
                  </span>
                </td>
                <td className="admin-mono">
                  <a className="admin-link" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>
                </td>
                <td>
                  {TIME[r.bestTime] ?? r.bestTime}
                  {r.timezone && <span className="admin-client">{r.timezone}</span>}
                </td>
                <td className="callback-note">{r.note || <span className="admin-muted">—</span>}</td>
                <td className="callback-act">
                  {r.status === "called" ? (
                    <>
                      <span className="admin-pill" title={r.calledAt ? new Date(r.calledAt).toLocaleString() : ""}>
                        Called {since(r.calledAt)}
                        {r.calledBy && ` · ${r.calledBy}`}
                      </span>
                      <button type="button" className="admin-link" disabled={busy === r.id} onClick={() => mark(r, "new")}>Not yet</button>
                    </>
                  ) : (
                    <button type="button" className="admin-btn is-primary" disabled={busy === r.id} onClick={() => mark(r, "called")}>
                      Mark called
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && !items.length && (
              <tr>
                <td colSpan={6} className="admin-empty">{status === "new" ? "No one is waiting for a call." : "No callback requests."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
