import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/authStore";
import "./ShellHeader.css";
import { DEPLOY_AVAILABLE, deployCloudPageUrl, deployConnectionsUrl, deployHomeUrl, deployListUrl, deployProjectUrl } from "../deployLinks";
import { usePanels } from "./PanelsContext";
import { importFromDevice } from "../utils/importFromDevice";
import { ContactCard, ProfileCard, SettingsCard, SupportCard } from "../components/ProfileCards";
import { BUILD } from "../utils/support";

/** A screen without hover (phones, tablets): menus open on a tap instead. */
const noHover = () => typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;

// continuum-create (Backstage), if this setup has one: VITE_CREATE_URL. Unset: its menu item is hidden.
const CREATE_URL = import.meta.env.VITE_CREATE_URL || "";

// Deploy menu: AWS, Railway and GCP are live. deploysProject: deploying a selected
// project works there (Railway and GCP; AWS opens its connections). soon: not supported
// yet; opens that cloud's own page in Continuum Deploy, which says so.
const DEPLOY_TARGETS = [
  { label: "AWS", cloud: "aws" },
  { label: "Railway", cloud: "railway", deploysProject: true },
  { label: "GCP", cloud: "gcp", deploysProject: true },
  { label: "Microsoft Azure", cloud: "azure", soon: true },
  { label: "Vercel", cloud: "vercel", soon: true },
  { label: "Netlify", cloud: "netlify", soon: true },
  { label: "Cloudflare", cloud: "cloudflare", soon: true },
  { label: "DigitalOcean", cloud: "digitalocean", soon: true },
  { label: "Heroku", cloud: "heroku", soon: true },
  { label: "Render", cloud: "render", soon: true },
  { label: "Oracle Cloud", cloud: "oracle", soon: true },
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
 * selectedProject (console only): Deploy on Railway or GCP deploys that project's
 * GitHub repository; without one it opens that cloud's deployments list.
 */
export default function ShellHeader({ selectedProject = null }) {
  const { user, authProvider, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [openMenu, setOpenMenu] = useState(null); // null | "create" | "deploy" | "profile"
  const panels = usePanels();

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

  // Deploy opens on hover or keyboard focus; a short delay lets the pointer cross to the list
  const deployCloseTimer = useRef(null);
  function openDeploy() {
    if (noHover()) return; // touch: the tap opens it (hover events would fight the tap)
    clearTimeout(deployCloseTimer.current);
    setOpenMenu("deploy");
  }
  function closeDeploySoon() {
    if (noHover()) return;
    clearTimeout(deployCloseTimer.current);
    deployCloseTimer.current = setTimeout(() => setOpenMenu((m) => (m === "deploy" ? null : m)), 200);
  }
  useEffect(() => () => clearTimeout(deployCloseTimer.current), []);

  // Only a project imported from GitHub has a repository to deploy
  const deployable = selectedProject?.source === "github" ? selectedProject : null;

  function openDeployApp(target) {
    setOpenMenu(null);
    // Deploy itself opens the start screen. A cloud that deploys: the selected project's deploy page,
    // or (none selected) that cloud's deployments. Clouds that don't deploy yet open their connections.
    // GCP without a project: its own step-by-step page (account, infrastructure, projects)
    const url = !target
      ? deployHomeUrl()
      : target.soon
        ? deployCloudPageUrl(target.cloud)
        : !target.deploysProject
          ? deployConnectionsUrl(target.cloud)
          : deployable
            ? deployProjectUrl(deployable._id, target.cloud)
            : target.cloud === "gcp"
              ? deployCloudPageUrl("gcp")
              : deployListUrl(target.cloud);
    // New tab, so a running interval here is never interrupted
    window.open(url, "_blank", "noopener");
  }

  function handleExternalCreate() {
    if (CREATE_URL) window.open(CREATE_URL, "_blank", "noopener");
    setOpenMenu(null);
  }

  // Import from device: pick a folder; the console's Create Project window opens with its name
  function handleImportFromDevice() {
    setOpenMenu(null);
    importFromDevice(() => pathname !== "/console" && navigate("/console"));
  }

  function handleSignOut() {
    setOpenMenu(null);
    logout();
  }

  // Profile menu: arrow keys move between its items; its cards (Settings, Support, Contact us)
  const avatarRef = useRef(null);
  const profileMenuRef = useRef(null);
  const [card, setCard] = useState(null); // null | "profile" | "settings" | "support" | "contact"
  function openCard(which) {
    setOpenMenu(null);
    setCard(which);
  }
  function closeCard() {
    setCard(null);
    avatarRef.current?.focus();
  }
  useEffect(() => {
    if (openMenu === "profile") profileMenuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [openMenu]);
  function onProfileMenuKey(e) {
    const items = [...(profileMenuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      setOpenMenu(null);
      avatarRef.current?.focus();
    }
  }

  return (
    <header className={`shell-header${panels.enabled ? " has-panels" : ""}`}>
      <div className="shell-brand">
        {panels.enabled && (
          <button
            type="button"
            className="shell-icon-btn shell-panel-btn"
            aria-label="Projects"
            title="Projects"
            aria-controls="console-projects"
            aria-expanded={panels.panel === "projects"}
            onClick={() => {
              setOpenMenu(null);
              panels.toggle("projects");
            }}
          >
            <span aria-hidden="true">☰</span>
          </button>
        )}
        <Link to="/" className="shell-title">
          Continuum Console
        </Link>
      </div>

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
                  {CREATE_URL && (
                    <button role="menuitem" onClick={handleExternalCreate}>
                      🚀 Create via Backstage
                    </button>
                  )}

                  <button role="menuitem" onClick={handleImportFromDevice}>
                    📁 Import from device
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

            {/* Deploy — click opens Continuum Deploy with all clouds; hover lists the clouds (only when this setup has one) */}
            {DEPLOY_AVAILABLE && (
<div
              className="shell-menu"
              onMouseEnter={openDeploy}
              onMouseLeave={closeDeploySoon}
              onFocus={openDeploy}
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && closeDeploySoon()}
            >
              <button
                type="button"
                className="shell-nav-btn"
                onClick={() => (noHover() ? toggle("deploy") : openDeployApp(null))}
                aria-haspopup="menu"
                aria-expanded={openMenu === "deploy"}
                title="Open Continuum Deploy (all clouds)"
              >
                Deploy ▾
              </button>

              {openMenu === "deploy" && (
                <div className="menu-dropdown" role="menu">
                  {/* On a touch screen the button opens this list, so the main page is here too */}
                  {noHover() && (
                    <button role="menuitem" className="menu-dropdown-lead" onClick={() => openDeployApp(null)}>
                      🚀 Open Continuum Deploy (all clouds)
                    </button>
                  )}
                  {selectedProject && (
                    <div className="menu-dropdown-note">
                      {deployable ? (
                        <>
                          Selected project: <strong>{deployable.name}</strong>
                        </>
                      ) : (
                        <>{selectedProject.name} has no GitHub repository to deploy</>
                      )}
                    </div>
                  )}
                  {DEPLOY_TARGETS.map((target) => (
                    <button
                      key={target.label}
                      role="menuitem"
                      disabled={!target.cloud}
                      onClick={() => openDeployApp(target)}
                      title={target.soon ? `${target.label}: coming soon` : target.deploysProject && deployable ? `Deploy ${deployable.name} on ${target.label}` : undefined}
                    >
                      ☁️ Deploy on {target.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </nav>

      <div className="shell-actions">
        {panels.enabled && (
          <button
            type="button"
            className="shell-nav-btn shell-panel-btn"
            aria-controls="console-bridges"
            aria-expanded={panels.panel === "bridges"}
            onClick={() => {
              setOpenMenu(null);
              panels.toggle("bridges");
            }}
          >
            Bridges
          </button>
        )}
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
            ref={avatarRef}
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
            <div className="menu-dropdown profile-menu" role="menu" aria-label="Account" ref={profileMenuRef} onKeyDown={onProfileMenuKey}>
              <div className="profile-menu-info">
                <span className="profile-menu-avatar" aria-hidden="true">{getInitials(user?.email)}</span>
                <span className="profile-menu-who">
                  <span className="profile-menu-email" title={user?.email}>{user?.email}</span>
                  <span className={`profile-menu-provider provider-${authProvider === "github" ? "github" : "email"}`}>
                    Signed in with {authProvider === "github" ? "GitHub" : "email"}
                  </span>
                </span>
              </div>

              <div className="profile-menu-group">
                <button role="menuitem" className="profile-menu-item" onClick={() => openCard("profile")}>
                  <span className="profile-menu-icon" aria-hidden="true">👤</span>
                  <span className="profile-menu-label">Profile</span>
                </button>
                <button
                  role="menuitem"
                  className="profile-menu-item"
                  aria-current={pathname === "/dashboard" ? "page" : undefined}
                  onClick={() => {
                    setOpenMenu(null);
                    navigate("/dashboard");
                  }}
                >
                  <span className="profile-menu-icon" aria-hidden="true">📊</span>
                  <span className="profile-menu-label">Dashboard</span>
                </button>
              </div>

              <div className="profile-menu-group">
                <button role="menuitem" className="profile-menu-item" onClick={() => openCard("settings")}>
                  <span className="profile-menu-icon" aria-hidden="true">⚙</span>
                  <span className="profile-menu-label">Settings</span>
                </button>
                <button role="menuitem" className="profile-menu-item" onClick={() => openCard("support")}>
                  <span className="profile-menu-icon" aria-hidden="true">🛟</span>
                  <span className="profile-menu-label">Support</span>
                </button>
                <button role="menuitem" className="profile-menu-item" onClick={() => openCard("contact")}>
                  <span className="profile-menu-icon" aria-hidden="true">✉</span>
                  <span className="profile-menu-label">Contact us</span>
                </button>
              </div>

              <div className="profile-menu-group">
                <button role="menuitem" className="profile-menu-item" onClick={handleSignOut}>
                  <span className="profile-menu-icon" aria-hidden="true">⎋</span>
                  <span className="profile-menu-label">Sign out</span>
                </button>
              </div>

              <div className="profile-menu-foot">Continuum Console · build {BUILD}</div>
            </div>
          )}
        </div>

        {card === "profile" && (
          <ProfileCard
            user={user}
            authProvider={authProvider}
            onClose={closeCard}
            onSignOut={() => {
              setCard(null);
              handleSignOut();
            }}
          />
        )}
        {card === "settings" && <SettingsCard user={user} authProvider={authProvider} onClose={closeCard} />}
        {card === "support" && <SupportCard user={user} authProvider={authProvider} onClose={closeCard} onContact={() => setCard("contact")} />}
        {card === "contact" && <ContactCard user={user} authProvider={authProvider} onClose={closeCard} />}
      </div>
    </header>
  );
}
