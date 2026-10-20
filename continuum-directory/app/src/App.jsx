import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { CONTINUUM_URL } from "./config";
import { ADMIN_SECTIONS } from "./admin/adminContext";

// Each section loads only when opened
const Organizations = lazy(() => import("./orgs/Organizations"));
const Admin = lazy(() => import("./admin/Admin"));

const THEME_KEY = "continuum_directory_theme";

/** The section from the address: /organizations (the default), or an admin one (/users, /roles…). */
const sectionOf = (path) => {
  const s = path.replace(/^\/+/, "").split("/")[0];
  return ADMIN_SECTIONS.some(([id]) => id === s) ? s : "organizations";
};

/**
 * Continuum Directory: your organizations, and for Continuum's admins its
 * users, roles, sign-ins, changes and production sync. Signed in through
 * Continuum; "Continuum" goes back there.
 */
export default function App() {
  const { status, error, access, can, signIn, signOut } = useAuth();
  // Chosen here, else from the address (which the return from Continuum's sign-in sets)
  const [chosen, setSection] = useState(null);
  const section = chosen ?? sectionOf(location.pathname);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    const onPop = () => setSection(sectionOf(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const t = theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // this visit only
    }
  }, [theme]);

  const go = (s) => {
    setSection(s);
    history.pushState(null, "", `/${s}`);
  };

  if (status === "checking") return <p className="dir-center admin-muted">Signing in through Continuum…</p>;
  if (status === "error" || status === "signed-out") {
    return (
      <div className="dir-center">
        <h1 className="dir-brand">
          continuum <span>Directory</span>
        </h1>
        <p className={status === "error" ? "admin-error" : "admin-muted"}>{status === "error" ? error : "You've signed out of the Directory."}</p>
        <button type="button" className="admin-btn is-primary" onClick={signIn}>
          Sign in with Continuum
        </button>
      </div>
    );
  }

  const nav = [["organizations", "Organizations", "🏢"], ...(can("admin") || access?.adminSetup ? ADMIN_SECTIONS : [])];

  return (
    <div className="dir-shell">
      <header className="dir-header">
        <a className="dir-brand" href="/organizations" onClick={(e) => (e.preventDefault(), go("organizations"))}>
          <img src="/logo-compact.png" alt="" width="22" height="22" />
          continuum <span>Directory</span>
        </a>
        <span className="dir-header-end">
          <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Theme" className="dir-theme">
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
          <span className="admin-muted dir-who" title={access?.email}>
            {access?.email}
          </span>
          <a className="admin-btn" href={CONTINUUM_URL}>
            Continuum
          </a>
          <button type="button" className="admin-btn" onClick={signOut}>
            Sign out
          </button>
        </span>
      </header>
      <nav className="dir-nav admin-nav" aria-label="Directory">
        <ul>
          {nav.map(([id, label, icon]) => (
            <li key={id}>
              <button type="button" className={section === id ? "is-on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => go(id)}>
                <span className="admin-nav-icon" aria-hidden="true">
                  {icon}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="dir-body">
        <Suspense fallback={<p className="admin-muted">Loading…</p>}>{section === "organizations" ? <Organizations /> : <Admin section={section} onSection={go} />}</Suspense>
      </main>
    </div>
  );
}
