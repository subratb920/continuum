import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/authStore";
import "./ShellHeader.css";

// Deploy menu placeholders (greyed out until deployment is defined)
const DEPLOY_TARGETS = [
  "AWS",
  "Google Cloud (GCP)",
  "Microsoft Azure",
  "Vercel",
  "Netlify",
  "Cloudflare",
  "DigitalOcean",
  "Heroku",
  "Render",
  "Oracle Cloud",
];

/**
 * Two letters for the avatar, from the email's local part:
 * john.smith@… → JS, subratb920@… → SU
 */
function getInitials(email) {
  if (!email) return "?";

  const local = email.split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);

  const letters =
    parts.length >= 2
      ? parts[0][0] + parts[1][0]
      : local.replace(/[^a-z]/gi, "").slice(0, 2);

  return (letters || local.slice(0, 2)).toUpperCase();
}

/**
 * ShellHeader
 * -----------
 * Shared header on every signed-in page (see PageShell).
 * Actions: + Create menu, Help, and a profile avatar whose menu holds
 * the email and Sign out. Only one menu is open at a time.
 */
export default function ShellHeader({ onManualCreate }) {
  const { user, authProvider, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [openMenu, setOpenMenu] = useState(null); // null | "create" | "deploy" | "profile"

  // Close on outside click (outside any header menu) or Escape
  useEffect(() => {
    if (!openMenu) return;

    function handleClick(e) {
      if (!e.target.closest?.(".shell-menu")) {
        setOpenMenu(null);
      }
    }

    function handleKey(e) {
      if (e.key === "Escape") setOpenMenu(null);
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenu]);

  function toggle(menu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function handleExternalCreate() {
    window.open("http://localhost:3000/create", "_blank");
    setOpenMenu(null);
  }

  function handleManual() {
    onManualCreate?.();
    setOpenMenu(null);
  }

  function handleSignOut() {
    setOpenMenu(null);
    logout();
  }

  return (
    <header className="shell-header">
      <Link to="/" className="shell-title">
        Continuum Console
      </Link>

      {/* Middle column: spans the Interval Setup box — Interval Setup on
          its left edge, + Create and Deploy on its right edge */}
      <nav className="shell-nav">
        <div className="shell-nav-inner">
          <button
            type="button"
            className="shell-nav-btn"
            aria-current={pathname === "/console" ? "page" : undefined}
            onClick={() => {
              setOpenMenu(null);
              navigate("/console");
            }}
          >
            Interval Setup
          </button>

          <div className="shell-nav-group">
            {/* + Create */}
            <div className="shell-menu">
              <button
                type="button"
                className="shell-nav-btn"
                onClick={() => toggle("create")}
                aria-haspopup="menu"
                aria-expanded={openMenu === "create"}
              >
                + Create ▾
              </button>

              {openMenu === "create" && (
                <div className="menu-dropdown" role="menu">
                  <button role="menuitem" onClick={handleExternalCreate}>
                    🚀 Create via Backstage
                  </button>

                  <button role="menuitem" onClick={handleManual}>
                    📝 Create Manually
                  </button>

                  {/* GitHub sign-ins only; greyed out for email sign-ins */}
                  <button
                    role="menuitem"
                    disabled={authProvider !== "github"}
                    onClick={() => {
                      setOpenMenu(null);
                      navigate("/import", { state: { from: pathname } });
                    }}
                  >
                    📦 Import Repo (Github)
                  </button>
                </div>
              )}
            </div>

            {/* Deploy — placeholders until deployment is defined */}
            <div className="shell-menu">
              <button
                type="button"
                className="shell-nav-btn"
                onClick={() => toggle("deploy")}
                aria-haspopup="menu"
                aria-expanded={openMenu === "deploy"}
              >
                Deploy ▾
              </button>

              {openMenu === "deploy" && (
                <div className="menu-dropdown" role="menu">
                  {DEPLOY_TARGETS.map((target) => (
                    <button key={target} role="menuitem" disabled>
                      ☁️ Deploy on {target}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="shell-actions">
        {/* Help — same control style as + Create */}
        <button
          type="button"
          className="shell-nav-btn"
          aria-current={pathname === "/help" ? "page" : undefined}
          onClick={() => {
            setOpenMenu(null);
            navigate("/help");
          }}
        >
          Help
        </button>

        {/* Profile avatar */}
        <div className="shell-menu">
          <button
            type="button"
            className="shell-avatar"
            onClick={() => toggle("profile")}
            title={user?.email}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={openMenu === "profile"}
          >
            {getInitials(user?.email)}
          </button>

          {openMenu === "profile" && (
            <div className="menu-dropdown profile-menu" role="menu">
              <div className="profile-menu-info">
                <div className="profile-menu-email">{user?.email}</div>
                <div className="profile-menu-provider">
                  Signed in with {authProvider === "github" ? "GitHub" : "email"}
                </div>
              </div>

              <button role="menuitem" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
