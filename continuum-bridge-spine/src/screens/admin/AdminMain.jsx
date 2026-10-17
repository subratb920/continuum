import { useState } from "react";
import { deviceText, since, useAdmin } from "./adminContext";
import "./admin.css";

/**
 * Admin (centre): the section showing — Users (search, filters, the list),
 * Roles (each feature a switch, per role), Sign-ins (everyone's, refused ones
 * too) and Admin changes. Picking a user or a role opens it on the right.
 */
export default function AdminMain() {
  const admin = useAdmin();
  if (!admin?.open) return null;
  return (
    <div className="admin">
      {admin.error && (
        <p className="admin-error" role="alert">
          {admin.error} <button type="button" className="admin-link" onClick={admin.clearError}>Dismiss</button>
        </p>
      )}
      {admin.section === "users" && <Users />}
      {admin.section === "roles" && <Roles />}
      {admin.section === "signins" && <SignIns />}
      {admin.section === "changes" && <Changes />}
    </div>
  );
}

const featureName = (features, id) => features.find((f) => f.id === id)?.label ?? id;

function Users() {
  const { users, roles, query, setQuery, select, selected, loading, features } = useAdmin();
  const pages = Math.max(1, Math.ceil(users.total / users.pageSize));
  return (
    <section aria-label="Users">
      <header className="admin-head">
        <h2>Users</h2>
        <span className="admin-muted">{users.total} {users.total === 1 ? "person" : "people"}</span>
      </header>
      <div className="admin-filters">
        <input type="search" placeholder="Search by email or GitHub name" value={query.search} onChange={(e) => setQuery({ search: e.target.value })} aria-label="Search users" />
        <select value={query.role} onChange={(e) => setQuery({ role: e.target.value })} aria-label="Role">
          <option value="">Every role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select value={query.status} onChange={(e) => setQuery({ status: e.target.value })} aria-label="Status">
          <option value="">Active and disabled</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <select value={query.seenDays} onChange={(e) => setQuery({ seenDays: e.target.value })} aria-label="Last seen">
          <option value="">Seen any time</option>
          <option value="1">Seen today</option>
          <option value="7">Seen this week</option>
          <option value="30">Seen this month</option>
        </select>
        <select value={query.sort} onChange={(e) => setQuery({ sort: e.target.value })} aria-label="Order">
          <option value="created">Newest first</option>
          <option value="seen">Last seen first</option>
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Last seen</th>
              <th>Last device</th>
              <th>Apps used</th>
            </tr>
          </thead>
          <tbody>
            {users.users.map((u) => (
              <tr key={u.id} className={`${selected?.kind === "user" && selected.id === u.id ? "is-selected" : ""}${u.disabled ? " is-disabled" : ""}`} onClick={() => select("user", u.id)}>
                <td>
                  <button type="button" className="admin-user" onClick={(e) => (e.stopPropagation(), select("user", u.id))}>
                    {u.github?.avatarUrl ? <img src={u.github.avatarUrl} alt="" className="admin-avatar" /> : <span className="admin-avatar" aria-hidden="true">{(u.email ?? "?").slice(0, 1).toUpperCase()}</span>}
                    <span className="admin-user-text">
                      <span className="admin-user-email">{u.email}</span>
                      <span className="admin-muted">
                        {u.signsInWith === "github" ? `GitHub${u.github?.login ? ` · ${u.github.login}` : ""}` : "Email"}
                        {u.disabled && <span className="admin-pill is-off">Disabled</span>}
                      </span>
                    </span>
                  </button>
                </td>
                <td>
                  <span className={`admin-pill${u.role.id === "admin" ? " is-admin" : ""}`}>{u.role.name}</span>
                </td>
                <td title={u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : ""}>{since(u.lastSeenAt)}</td>
                <td className="admin-muted">{deviceText(u.lastDevice) || "—"}</td>
                <td>
                  <span className="admin-apps">
                    {u.apps.slice(0, 4).map((a) => (
                      <span key={a.app} className="admin-app" title={`${a.count} times on ${a.days} ${a.days === 1 ? "day" : "days"}, last ${since(a.lastAt)}`}>
                        {featureName(features, a.app)} <b>{a.count}</b>
                      </span>
                    ))}
                    {u.apps.length > 4 && <span className="admin-muted">+{u.apps.length - 4}</span>}
                    {!u.apps.length && <span className="admin-muted">—</span>}
                  </span>
                </td>
              </tr>
            ))}
            {!users.users.length && (
              <tr>
                <td colSpan={5} className="admin-empty">{loading ? "Loading…" : "Nobody matches."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="admin-pages" aria-label="Pages">
          <button type="button" className="admin-btn" disabled={users.page <= 1} onClick={() => setQuery({ page: users.page - 1 })}>Previous</button>
          <span className="admin-muted">Page {users.page} of {pages}</span>
          <button type="button" className="admin-btn" disabled={users.page >= pages} onClick={() => setQuery({ page: users.page + 1 })}>Next</button>
        </nav>
      )}
    </section>
  );
}

/** One switch: a feature on or off for a role. */
function Switch({ on, disabled, label, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={`admin-switch${on ? " is-on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="admin-switch-knob" aria-hidden="true" />
    </button>
  );
}

function Roles() {
  const { roles, features, toggleFeature, select, selected, createRole } = useAdmin();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function add(e) {
    e.preventDefault();
    setError("");
    try {
      const r = await createRole({ name, description: "", features: ["interval", "dashboard"] });
      setName("");
      setAdding(false);
      select("role", r.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section aria-label="Roles">
      <header className="admin-head">
        <h2>Roles</h2>
        <span className="admin-muted">Each feature is a switch: off, people with that role see "No feature access".</span>
        <button type="button" className="admin-btn is-primary" onClick={() => setAdding((a) => !a)}>＋ New role</button>
      </header>
      {adding && (
        <form className="admin-inline-form" onSubmit={add}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name, e.g. Viewer" aria-label="New role's name" maxLength={40} />
          <button type="submit" className="admin-btn is-primary" disabled={!name.trim()}>Create</button>
          <button type="button" className="admin-btn" onClick={() => setAdding(false)}>Cancel</button>
          {error && <span className="admin-field-error" role="alert">{error}</span>}
        </form>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table admin-matrix">
          <thead>
            <tr>
              <th>Role</th>
              {features.map((f) => (
                <th key={f.id} title={f.description}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className={selected?.kind === "role" && selected.id === r.id ? "is-selected" : ""}>
                <th scope="row">
                  <button type="button" className="admin-role-name" onClick={() => select("role", r.id)}>
                    {r.name}
                    <span className="admin-muted">
                      {r.users} {r.users === 1 ? "user" : "users"}
                      {r.isDefault && " · default"}
                    </span>
                  </button>
                </th>
                {features.map((f) => (
                  <td key={f.id}>
                    <Switch
                      on={r.features.includes(f.id)}
                      disabled={r.locked}
                      label={`${f.label} for ${r.name}: ${r.features.includes(f.id) ? "on" : "off"}${r.locked ? " (Admin always has everything)" : ""}`}
                      onChange={(on) => toggleFeature(r, f.id, on)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const METHOD = { email: "Email", github: "GitHub", deploy: "Continuum Deploy" };

function SignIns() {
  const { signins, select } = useAdmin();
  const [failedOnly, setFailedOnly] = useState(false);
  const list = (signins ?? []).filter((l) => !failedOnly || !l.ok);
  return (
    <section aria-label="Sign-ins">
      <header className="admin-head">
        <h2>Sign-ins</h2>
        <label className="admin-check">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Refused only
        </label>
      </header>
      <LoginList logins={list} onUser={(id) => id && select("user", id)} loading={!signins} showWho />
    </section>
  );
}

/** Sign-ins: when, who, how, from where, on what (refused ones marked). compact: a stacked list, for a narrow pane. */
export function LoginList({ logins, onUser, loading, showWho = false, compact = false }) {
  if (compact) {
    return (
      <ul className="admin-login-list">
        {logins.map((l) => (
          <li key={l.id} className={l.ok ? "" : "is-refused"}>
            <span className="admin-login-top">
              <span>
                {METHOD[l.method] ?? l.method}
                {l.signup && <span className="admin-pill">New account</span>}
                {!l.ok && <span className="admin-pill is-off" title={l.reason}>Refused</span>}
              </span>
              <span className="admin-muted" title={new Date(l.at).toLocaleString()}>{since(l.at)}</span>
            </span>
            <span className="admin-muted">{deviceText(l) || "—"}</span>
            <span className="admin-mono admin-muted">
              {l.ip ?? "—"}
              {l.region && ` · ${[l.city, l.region].filter(Boolean).join(", ")}`}
            </span>
            {l.client && <span className="admin-client">{[l.client.screen, l.client.timezone, l.client.language].filter(Boolean).join(" · ")}</span>}
          </li>
        ))}
        {!logins.length && <li className="admin-empty">No sign-ins.</li>}
      </ul>
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            {showWho && <th>Who</th>}
            <th>How</th>
            <th>From</th>
            <th>Device</th>
          </tr>
        </thead>
        <tbody>
          {logins.map((l) => (
            <tr key={l.id} className={l.ok ? "" : "is-refused"}>
              <td title={new Date(l.at).toLocaleString()}>{since(l.at)}</td>
              {showWho && (
                <td>
                  {l.userId ? <button type="button" className="admin-link" onClick={() => onUser(l.userId)}>{l.email}</button> : l.email}
                </td>
              )}
              <td>
                {METHOD[l.method] ?? l.method}
                {l.signup && <span className="admin-pill">New account</span>}
                {!l.ok && <span className="admin-pill is-off" title={l.reason}>Refused</span>}
              </td>
              <td className="admin-mono">
                {l.ip ?? "—"}
                {l.region && <span className="admin-muted"> · {[l.city, l.region].filter(Boolean).join(", ")}</span>}
              </td>
              <td className="admin-muted" title={l.userAgent ?? ""}>
                {deviceText(l) || "—"}
                {l.client && <span className="admin-client">{[l.client.screen, l.client.timezone, l.client.language].filter(Boolean).join(" · ")}</span>}
              </td>
            </tr>
          ))}
          {!logins.length && (
            <tr>
              <td colSpan={showWho ? 5 : 4} className="admin-empty">{loading ? "Loading…" : "No sign-ins."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const CHANGE = {
  ADMIN_USER_UPDATED: (m) => `${m.email ?? "A user"}: ${[m.after?.roleId !== undefined && `role → ${m.after.roleId}`, m.after?.disabled === true && "disabled", m.after?.disabled === false && "enabled"].filter(Boolean).join(", ")}`,
  ADMIN_ROLE_CREATED: (m) => `Role "${m.name}" created`,
  ADMIN_ROLE_UPDATED: (m) => `Role "${m.after?.name ?? m.role}" changed`,
  ADMIN_ROLE_DELETED: (m) => `Role "${m.deleted}" deleted; ${m.moved} ${m.moved === 1 ? "user" : "users"} moved to ${m.movedTo}`,
  ADMIN_SETTINGS_UPDATED: (m) => `New users now get "${m.defaultRoleId}"`,
};

function Changes() {
  const { changes } = useAdmin();
  return (
    <section aria-label="Admin changes">
      <header className="admin-head">
        <h2>Admin changes</h2>
        <span className="admin-muted">Every change an admin made, newest first.</span>
      </header>
      <ul className="admin-changes">
        {(changes ?? []).map((c) => (
          <li key={c.id}>
            <span>{CHANGE[c.type]?.(c.metadata ?? {}) ?? c.type}</span>
            <span className="admin-muted" title={new Date(c.at).toLocaleString()}>
              {c.byEmail ?? "an admin"} · {since(c.at)}
            </span>
          </li>
        ))}
        {changes && !changes.length && <li className="admin-empty">No changes yet.</li>}
        {!changes && <li className="admin-empty">Loading…</li>}
      </ul>
    </section>
  );
}
