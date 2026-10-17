import { useEffect, useState } from "react";
import { adminApi } from "../../api";
import { useAuth } from "../../state/authStore";
import { deviceText, networkText, placeText, since, useAdmin } from "./adminContext";
import { LoginList } from "./AdminMain";
import "./admin.css";

/** Admin (right): the selected user or role, to see and change; else a hint. */
export default function AdminDetail() {
  const admin = useAdmin();
  if (!admin?.open) return null;
  if (admin.selected?.kind === "user") return <UserDetail key={admin.selected.id} id={admin.selected.id} />;
  if (admin.selected?.kind === "role") {
    const role = admin.roles.find((r) => r.id === admin.selected.id);
    if (role) return <RoleDetail key={role.id} role={role} />;
  }
  return <p className="admin-hint">Pick a user or a role to see it here.</p>;
}

function UserDetail({ id }) {
  const { roles, features, updateUser, select } = useAdmin();
  const { access } = useAuth();
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await adminApi.signOutUser(id);
      setSignedOut(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let live = true;
    adminApi.user(id).then((u) => live && setUser(u)).catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [id]);

  async function change(changes) {
    setBusy(true);
    setError("");
    try {
      setUser(await updateUser(id, changes));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <p className="admin-hint">{error || "Loading…"}</p>;
  const me = String(access?.id) === user.id;
  const name = (f) => features.find((x) => x.id === f)?.label ?? f;
  return (
    <div className="admin-detail">
      <div className="admin-detail-top">
        {user.github?.avatarUrl ? <img src={user.github.avatarUrl} alt="" className="admin-avatar is-big" /> : <span className="admin-avatar is-big" aria-hidden="true">{(user.email ?? "?").slice(0, 1).toUpperCase()}</span>}
        <div>
          <h3>{user.github?.name || user.email}</h3>
          <p className="admin-muted">{user.email}</p>
        </div>
        <button type="button" className="admin-link admin-close" onClick={() => select(null)} aria-label="Close">✕</button>
      </div>

      <dl className="admin-facts">
        <dt>Signs in with</dt>
        <dd>{user.signsInWith === "github" ? `GitHub${user.github?.login ? ` (${user.github.login})` : ""}` : "Email"}</dd>
        <dt>Joined</dt>
        <dd>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</dd>
        <dt>Last sign-in</dt>
        <dd>{since(user.lastLoginAt)}</dd>
        <dt>Last seen</dt>
        <dd>{since(user.lastSeenAt)}</dd>
        <dt>Last device</dt>
        <dd>
          {deviceText(user.lastDevice) || "—"}
          {user.lastDevice?.ip && <span className="admin-mono"> · {user.lastDevice.ip}</span>}
          {placeText(user.lastDevice) && <span> · {placeText(user.lastDevice)}</span>}
          {networkText(user.lastDevice) && <span className="admin-client">{networkText(user.lastDevice)}</span>}
          {user.lastDevice?.client && <span className="admin-client">{[user.lastDevice.client.platform, user.lastDevice.client.screen, user.lastDevice.client.timezone, user.lastDevice.client.language].filter(Boolean).join(" · ")}</span>}
        </dd>
        <dt>Projects</dt>
        <dd>{user.projects}</dd>
      </dl>

      <section className="admin-block">
        <h4>Role</h4>
        {user.owner ? (
          <p className="admin-muted">Admin: Continuum's owner, always an admin.</p>
        ) : (
          <select value={user.role.id} disabled={busy} onChange={(e) => change({ roleId: e.target.value })} aria-label="Role">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
      </section>

      <section className="admin-block">
        <h4>Account</h4>
        {user.disabled ? (
          <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => change({ disabled: false })}>Enable account</button>
        ) : (
          <button type="button" className="admin-btn is-danger" disabled={busy || me || user.owner} title={me ? "You can't disable your own account" : user.owner ? "Continuum's owner can't be disabled" : "They're signed out everywhere and can't use Continuum or Deploy until enabled"} onClick={() => change({ disabled: true })}>
            Disable account
          </button>
        )}
        {user.disabled && <p className="admin-muted">Disabled: they can't use Continuum or Continuum Deploy.</p>}
        <button type="button" className="admin-btn" disabled={busy} onClick={signOut} title="Every device: they must sign in again (Continuum and Continuum Deploy)">
          Sign out everywhere
        </button>
        {signedOut && <p className="admin-muted" role="status">{me ? "Signed out everywhere: this page will ask you to sign in again." : "Signed out everywhere: they must sign in again."}</p>}
      </section>

      {error && <p className="admin-error" role="alert">{error}</p>}

      <section className="admin-block">
        <h4>Apps used</h4>
        {user.apps.length ? (
          <ul className="admin-app-list">
            {user.apps.map((a) => (
              <li key={a.app}>
                <span>{name(a.app)}</span>
                <span className="admin-muted">
                  {a.count} {a.count === 1 ? "time" : "times"} · {a.days} {a.days === 1 ? "day" : "days"} · last {since(a.lastAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">Not yet.</p>
        )}
      </section>

      <section className="admin-block">
        <h4>Sign-ins</h4>
        <LoginList logins={user.logins} compact />
      </section>
    </div>
  );
}

function RoleDetail({ role }) {
  const { roles, features, updateRole, deleteRole, setDefaultRole, toggleFeature, select } = useAdmin();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [moveTo, setMoveTo] = useState("member");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  async function run(act) {
    setError("");
    try {
      await act();
    } catch (err) {
      setError(err.message);
    }
  }

  const changed = name.trim() !== role.name || description.trim() !== role.description;
  return (
    <div className="admin-detail">
      <div className="admin-detail-top">
        <div>
          <h3>{role.name}</h3>
          <p className="admin-muted">
            {role.users} {role.users === 1 ? "user" : "users"}
            {role.builtIn && " · built in"}
            {role.isDefault && " · new users get it"}
          </p>
        </div>
        <button type="button" className="admin-link admin-close" onClick={() => select(null)} aria-label="Close">✕</button>
      </div>

      <form className="admin-block" onSubmit={(e) => (e.preventDefault(), run(() => updateRole(role.id, { ...(role.builtIn ? {} : { name }), description })))}>
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={role.builtIn} maxLength={40} />
        </label>
        <label className="admin-field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="What this role is for" />
        </label>
        <button type="submit" className="admin-btn is-primary" disabled={!changed || !name.trim()}>Save</button>
      </form>

      <section className="admin-block">
        <h4>Features</h4>
        {role.locked && <p className="admin-muted">Admin always has every feature.</p>}
        <ul className="admin-feature-list">
          {features.map((f) => {
            const on = role.features.includes(f.id);
            return (
              <li key={f.id}>
                <span>
                  {f.label}
                  <span className="admin-muted">{f.description}</span>
                </span>
                <button type="button" role="switch" aria-checked={on} aria-label={`${f.label}: ${on ? "on" : "off"}`} className={`admin-switch${on ? " is-on" : ""}`} disabled={role.locked} onClick={() => run(() => toggleFeature(role, f.id, !on))}>
                  <span className="admin-switch-knob" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="admin-block">
        <h4>New users</h4>
        {role.isDefault ? (
          <p className="admin-muted">New accounts get this role.</p>
        ) : (
          <button type="button" className="admin-btn" onClick={() => run(() => setDefaultRole(role.id))}>Give new users this role</button>
        )}
      </section>

      {!role.builtIn && (
        <section className="admin-block">
          <h4>Delete</h4>
          {!confirming ? (
            <button type="button" className="admin-btn is-danger" onClick={() => setConfirming(true)}>Delete role…</button>
          ) : (
            <div className="admin-confirm">
              <label className="admin-field">
                <span>Move its {role.users} {role.users === 1 ? "user" : "users"} to</span>
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {roles.filter((r) => r.id !== role.id).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="admin-btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="admin-btn is-danger" onClick={() => run(() => deleteRole(role.id, moveTo))}>Delete {role.name}</button>
            </div>
          )}
        </section>
      )}

      {error && <p className="admin-error" role="alert">{error}</p>}
    </div>
  );
}
