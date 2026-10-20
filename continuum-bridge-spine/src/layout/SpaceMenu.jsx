import { useState } from "react";
import { orgsApi } from "../api";
import { useAuth } from "../state/authStore";
import { ORG_ROLE_LABEL } from "../state/space";
import { DIRECTORY_AVAILABLE, openDirectory } from "../directoryLinks";

/** The space switcher's menu: your spaces, invites to join, a new organization, and the Directory. */
export default function SpaceMenu({ onClose }) {
  const { spaces, space, invites, switchSpace, reloadSpaces } = useAuth();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.message || "That didn't work.");
    }
    setBusy(false);
  }

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const org = await orgsApi.create(name.trim());
      await switchSpace(org.id);
    });
  };

  const isOrg = space?.kind === "org";

  return (
    <div className="menu-dropdown profile-menu space-menu" role="menu" aria-label="Spaces">
      <div className="profile-menu-group" role="group" aria-label="Your spaces">
        <div className="views-menu-title">Work in</div>
        {spaces.map((s) => (
          <button
            key={s.id}
            role="menuitemradio"
            aria-checked={s.id === space?.id}
            className="profile-menu-item"
            disabled={busy}
            onClick={() => (s.id === space?.id ? onClose() : run(() => switchSpace(s.id)))}
          >
            <span className="profile-menu-icon" aria-hidden="true">
              {s.id === space?.id ? "✓" : s.kind === "org" ? "🏢" : "👤"}
            </span>
            <span className="profile-menu-label">{s.name}</span>
            {s.kind === "org" && <span className="space-menu-role">{ORG_ROLE_LABEL[s.orgRole] ?? s.orgRole}</span>}
          </button>
        ))}
      </div>

      {invites.length > 0 && (
        <div className="profile-menu-group" role="group" aria-label="Invites">
          <div className="views-menu-title">Invites</div>
          {invites.map((i) => (
            <div key={i.id} className="space-menu-invite">
              <span>
                <strong>{i.orgName}</strong> invites you as {ORG_ROLE_LABEL[i.orgRole] ?? i.orgRole}
              </span>
              <span className="space-menu-invite-actions">
                <button type="button" className="space-btn is-primary" disabled={busy} onClick={() => run(async () => switchSpace((await orgsApi.acceptInvite(i.id)).id))}>
                  Join
                </button>
                <button type="button" className="space-btn" disabled={busy} onClick={() => run(async () => (await orgsApi.declineInvite(i.id), await reloadSpaces()))}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="profile-menu-group">
        {isOrg && DIRECTORY_AVAILABLE && (
          <button
            role="menuitem"
            className="profile-menu-item"
            title="Opens Continuum Directory in a new tab"
            onClick={() => {
              onClose();
              openDirectory("organizations", space.orgId);
            }}
          >
            <span className="profile-menu-icon" aria-hidden="true">
              ⚙
            </span>
            <span className="profile-menu-label">{space.name}: members and departments ↗</span>
          </button>
        )}
        {naming ? (
          <form className="space-menu-new" onSubmit={create}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" aria-label="Organization name" maxLength={80} />
            <button type="submit" className="space-btn is-primary" disabled={busy || !name.trim()}>
              {busy ? "Making…" : "Make"}
            </button>
            <button type="button" className="space-btn" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button role="menuitem" className="profile-menu-item" onClick={() => setNaming(true)}>
            <span className="profile-menu-icon" aria-hidden="true">
              ＋
            </span>
            <span className="profile-menu-label">New organization</span>
          </button>
        )}
      </div>
      {error && (
        <p className="space-menu-error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-menu-foot">An organization's roles are its own: its admins aren't Continuum's admins.</div>
    </div>
  );
}
