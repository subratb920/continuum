import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { meApi, orgsApi } from "../api";
import { ORG_ROLE_LABEL } from "./roles";
import "../admin/admin.css";
import "./Organization.css";

const Organization = lazy(() => import("./Organization"));

/**
 * Your organizations: the ones you're in (with your role there), invites to
 * your email waiting for you, and making a new one. Picking one shows its
 * members, departments, invites and projects.
 */
export default function Organizations() {
  const [data, setData] = useState(null); // { spaces, invites }
  const [picked, setPicked] = useState(() => new URLSearchParams(location.search).get("org"));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await meApi.spaces());
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const pick = (orgId) => {
    setPicked(orgId);
    history.replaceState(null, "", orgId ? `/organizations?org=${orgId}` : "/organizations");
  };

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err?.message || "That didn't work.");
    }
    setBusy(false);
  }

  const orgs = data?.spaces.filter((s) => s.kind === "org") ?? [];
  const current = orgs.find((o) => o.orgId === picked);

  return (
    <div className="dir-split">
      <aside className="dir-list" aria-label="Your organizations">
        <h2 className="admin-nav-title">Your organizations</h2>
        {!data && !error && <p className="admin-muted">Loading…</p>}
        <ul>
          {orgs.map((o) => (
            <li key={o.orgId}>
              <button type="button" className={o.orgId === picked ? "is-on" : ""} aria-current={o.orgId === picked ? "page" : undefined} onClick={() => pick(o.orgId)}>
                <span>🏢 {o.name}</span>
                <span className="admin-muted">{ORG_ROLE_LABEL[o.orgRole] ?? o.orgRole}</span>
              </button>
            </li>
          ))}
        </ul>
        {data && !orgs.length && <p className="admin-muted">None yet.</p>}

        {data?.invites?.length > 0 && (
          <>
            <h2 className="admin-nav-title">Invites</h2>
            {data.invites.map((i) => (
              <div key={i.id} className="dir-invite">
                <span>
                  <strong>{i.orgName}</strong> invites you as {ORG_ROLE_LABEL[i.orgRole] ?? i.orgRole}
                </span>
                <span className="dir-row">
                  <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => run(async () => pick((await meApi.acceptInvite(i.id)).orgId))}>
                    Join
                  </button>
                  <button type="button" className="admin-btn" disabled={busy} onClick={() => run(() => meApi.declineInvite(i.id))}>
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </>
        )}

        <form
          className="dir-new"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const org = await orgsApi.create(name.trim());
              setName("");
              pick(org.orgId);
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New organization" aria-label="New organization's name" maxLength={80} />
          <button type="submit" className="admin-btn" disabled={busy || !name.trim()}>
            Make
          </button>
        </form>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
      </aside>

      <div className="dir-main">
        {current ? (
          <Suspense fallback={<p className="admin-muted">Loading…</p>}>
            <Organization key={current.orgId} orgId={current.orgId} onChanged={load} onGone={() => (pick(null), load())} />
          </Suspense>
        ) : (
          <section className="admin org">
            <header className="admin-head">
              <h2>Organizations</h2>
            </header>
            <p className="admin-hint">
              Pick one of your organizations to see its members, departments, invites and projects, or make a new one. In Continuum, the switcher at the top chooses which one you work in. An
              organization's roles are its own: its admins aren't Continuum's admins.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
