import { lazy, Suspense } from "react";
import { useAuth } from "../state/authStore";
import { ORG_ROLE_LABEL } from "../state/space";

// The menu loads only when opened
const SpaceMenu = lazy(() => import("./SpaceMenu"));

/**
 * Where you work: your personal space or one of your organizations (like
 * GitHub's switcher). Projects, intervals and the active project are the
 * space's; switching loads the page again for it. Invites waiting for your
 * email are in its menu, and making a new organization; running one is the
 * Directory's (it opens in a new tab).
 */
export default function SpaceSwitcher({ open, onToggle, onClose }) {
  const { space, invites } = useAuth();
  const isOrg = space?.kind === "org";

  return (
    <div className="shell-menu shell-space">
      <button
        type="button"
        className={`shell-nav-btn shell-space-btn${isOrg ? " is-org" : ""}`}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isOrg ? `Working in ${space.name} (${ORG_ROLE_LABEL[space.orgRole] ?? space.orgRole})` : "Working in your personal space"}
      >
        <span aria-hidden="true">{isOrg ? "🏢" : "👤"}</span>
        <span className="shell-space-name">{space?.name ?? "Personal"}</span>
        {invites.length > 0 && (
          <span className="switcher-badge" aria-label={`${invites.length} invite${invites.length === 1 ? "" : "s"}`}>
            {invites.length}
          </span>
        )}
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <Suspense fallback={null}>
          <SpaceMenu onClose={onClose} />
        </Suspense>
      )}
    </div>
  );
}
