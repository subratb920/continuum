import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProjects, requestCallback } from "../api";
import { resetPreferences, resolvedTheme, setPreference, usePreferences } from "../utils/preferences";
import { DEPLOY_AVAILABLE, deployHomeUrl } from "../deployLinks";
import { BUILD, diagnostics, mailto, SUPPORT_EMAIL, SUPPORT_PHONE } from "../utils/support";
import "./ProfileCards.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const CREATE_URL = import.meta.env.VITE_CREATE_URL || "";

/**
 * The cards the profile menu opens: Settings, Support, Contact us.
 * A centred card on a computer, a sheet from the bottom on a phone.
 * Esc, the × or a click outside closes it; focus returns to the avatar.
 */
function Card({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="pcard-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`pcard${wide ? " pcard-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="pcard-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="pcard-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="pcard-body">{children}</div>
      </section>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pcard-btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is still visible to copy by hand */
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`pcard-toggle${disabled ? " is-disabled" : ""}`}>
      <span className="pcard-toggle-text">
        <span className="pcard-toggle-label">{label}</span>
        {hint && <span className="pcard-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="pcard-switch" aria-hidden="true" />
    </label>
  );
}

/* ---------------- Profile ---------------- */

function initialsOf(email) {
  if (!email) return "?";
  const local = email.split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.replace(/[^a-z]/gi, "").slice(0, 2);
  return (letters || local.slice(0, 2)).toUpperCase();
}

/** The user's projects (for counts), loaded once per card. */
function useProjects() {
  const [projects, setProjects] = useState(null);
  useEffect(() => {
    let live = true;
    fetchProjects()
      .then((list) => live && setProjects(list))
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, []);
  return projects;
}

export function ProfileCard({ user, authProvider, onClose, onSignOut }) {
  const projects = useProjects();
  return (
    <Card title="Profile" onClose={onClose}>
      <div className="pcard-profile">
        <span className="pcard-avatar" aria-hidden="true">{initialsOf(user?.email)}</span>
        <div className="pcard-profile-who">
          <strong title={user?.email}>{user?.email ?? "—"}</strong>
          <span className={`pcard-badge ${authProvider === "github" ? "is-github" : ""}`}>Signed in with {authProvider === "github" ? "GitHub" : "email"}</span>
        </div>
      </div>
      <dl className="pcard-facts">
        <div>
          <dt>Projects</dt>
          <dd>{projects === null ? "…" : projects.length}</dd>
        </div>
        <div>
          <dt>User ID</dt>
          <dd className="pcard-id">
            <code>{user?.id ?? "—"}</code>
            {user?.id && <CopyButton text={String(user.id)} />}
          </dd>
        </div>
      </dl>
      <div className="pcard-actions">
        <button type="button" className="pcard-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </Card>
  );
}

/* ---------------- Settings ---------------- */

const SECTIONS = [
  ["general", "General", "⚙"],
  ["projects", "Projects", "📂"],
  ["integrations", "Integrations", "🔗"],
  ["developer", "Developer", "</>"],
  ["organizations", "Organizations", "🏢"],
  ["appearance", "Appearance", "🎨"],
];

function Choice({ value, options, onChange, label }) {
  return (
    <div className="pcard-choice" role="radiogroup" aria-label={label}>
      {options.map(([v, text, disabled]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} className={value === v ? "is-on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="pcard-row">
      <span className="pcard-toggle-text">
        <span className="pcard-toggle-label">{label}</span>
        {hint && <span className="pcard-hint">{hint}</span>}
      </span>
      <span className="pcard-row-control">{children}</span>
    </div>
  );
}

function GeneralSection({ prefs, set }) {
  const [permission, setPermission] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  async function toggleNotifications(on) {
    set("desktopNotifications", on);
    if (on && permission === "default") {
      try {
        setPermission(await Notification.requestPermission());
      } catch {
        /* the browser didn't ask */
      }
    }
  }
  const notifHint =
    permission === "unsupported"
      ? "This browser can't show notifications."
      : permission === "denied"
        ? "Blocked in your browser's site settings: allow notifications there to get them."
        : "A notification when an interval ends, even in another tab.";
  const example = new Date(2026, 0, 1, 14, 5).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: prefs.clock === "12" ? true : prefs.clock === "24" ? false : undefined });
  return (
    <>
      <h3 className="pcard-section">Interval alerts</h3>
      <Toggle checked={prefs.intervalSound} onChange={(v) => set("intervalSound", v)} label="Interval-end sound" hint="Two soft notes when the time is up." />
      <Toggle checked={prefs.desktopNotifications && permission !== "denied"} disabled={permission === "unsupported" || permission === "denied"} onChange={toggleNotifications} label="Desktop notifications" hint={notifHint} />
      <h3 className="pcard-section">Time</h3>
      <Row label="Clock" hint={`Times in Continuum show like ${example}.`}>
        <Choice label="Clock" value={prefs.clock} onChange={(v) => set("clock", v)} options={[["auto", "Device"], ["12", "12 h"], ["24", "24 h"]]} />
      </Row>
    </>
  );
}

function ProjectsSection({ prefs, set }) {
  const projects = useProjects();
  const count = (test) => (projects ?? []).filter(test).length;
  return (
    <>
      <h3 className="pcard-section">New projects</h3>
      <Toggle checked={prefs.folderOptionDefault} onChange={(v) => set("folderOptionDefault", v)} label="Create a folder on this device, by default" hint="Ticks the option in Create project and Import from GitHub (you can still untick it)." />
      <h3 className="pcard-section">Projects pane</h3>
      <Toggle checked={prefs.openFilesOnSelect} onChange={(v) => set("openFilesOnSelect", v)} label="Open a device project's files when it's selected" hint="Off: they open with the ▸ next to the project." />
      <h3 className="pcard-section">Your projects</h3>
      {projects === null ? (
        <p className="pcard-text">Loading…</p>
      ) : (
        <dl className="pcard-facts">
          <div>
            <dt>All</dt>
            <dd>{projects.length}</dd>
          </div>
          <div>
            <dt>GitHub</dt>
            <dd>
              {count((p) => p.source === "github")} ({count((p) => p.source === "github" && p.visibility === "private")} private, {count((p) => p.source === "github" && p.visibility === "public")} public)
            </dd>
          </div>
          <div>
            <dt>From device</dt>
            <dd>{count((p) => p.source === "device")}</dd>
          </div>
          <div>
            <dt>Local</dt>
            <dd>{count((p) => p.source === "local")}</dd>
          </div>
        </dl>
      )}
    </>
  );
}

function Integration({ icon, name, status, on, children }) {
  return (
    <div className="pcard-integration">
      <span className="pcard-option-icon" aria-hidden="true">{icon}</span>
      <span className="pcard-integration-text">
        <strong>{name}</strong>
        <span className={`pcard-status ${on ? "is-on" : ""}`}>{status}</span>
      </span>
      {children}
    </div>
  );
}

function IntegrationsSection({ authProvider }) {
  const github = authProvider === "github";
  return (
    <>
      <h3 className="pcard-section">Connected services</h3>
      <Integration icon="🐙" name="GitHub" on={github} status={github ? "Connected: import repositories and deploy them" : "Not connected: you signed in with email"}>
        {!github && (
          <a className="pcard-btn small" href={`${API_BASE}/auth/github`}>
            Sign in with GitHub
          </a>
        )}
      </Integration>
      <Integration icon="🚀" name="Continuum Deploy" on={DEPLOY_AVAILABLE} status={DEPLOY_AVAILABLE ? "Available: deploy projects to the cloud" : "Not set up for this Continuum"}>
        {DEPLOY_AVAILABLE && (
          <a className="pcard-btn small" href={deployHomeUrl()} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
        )}
      </Integration>
      <Integration icon="🧱" name="Backstage" on={Boolean(CREATE_URL)} status={CREATE_URL ? "Available: create projects from templates" : "Not set up for this Continuum"}>
        {CREATE_URL && (
          <a className="pcard-btn small" href={CREATE_URL} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
        )}
      </Integration>
    </>
  );
}

function DeveloperSection({ user, prefs, set, onReset }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <h3 className="pcard-section">This app</h3>
      <dl className="pcard-facts">
        <div>
          <dt>User ID</dt>
          <dd className="pcard-id">
            <code>{user?.id ?? "—"}</code>
            {user?.id && <CopyButton text={String(user.id)} />}
          </dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>{BUILD}</dd>
        </div>
        <div>
          <dt>API</dt>
          <dd className="pcard-id">
            <code>{API_BASE}</code>
          </dd>
        </div>
      </dl>
      <h3 className="pcard-section">Debugging</h3>
      <Toggle checked={prefs.debugLogs} onChange={(v) => set("debugLogs", v)} label="Show debug logs in the browser console" hint="What the app does, step by step (no passwords or tokens). Development builds always log." />
      <h3 className="pcard-section">Reset</h3>
      {confirm ? (
        <div className="pcard-confirm">
          <p className="pcard-text">Put every setting on this device back to its default? Your projects and bridges aren't touched.</p>
          <div className="pcard-actions">
            <button type="button" className="pcard-btn" onClick={() => setConfirm(false)}>
              Keep them
            </button>
            <button
              type="button"
              className="pcard-btn danger"
              onClick={() => {
                onReset();
                setConfirm(false);
              }}
            >
              Reset settings
            </button>
          </div>
        </div>
      ) : (
        <Row label="Reset settings on this device" hint="Alerts, clock, projects pane, appearance and debugging back to their defaults.">
          <button type="button" className="pcard-btn small" onClick={() => setConfirm(true)}>
            Reset…
          </button>
        </Row>
      )}
    </>
  );
}

function OrganizationsSection({ user }) {
  return (
    <>
      <h3 className="pcard-section">Your workspace</h3>
      <div className="pcard-integration">
        <span className="pcard-option-icon" aria-hidden="true">{initialsOf(user?.email)}</span>
        <span className="pcard-integration-text">
          <strong>Personal</strong>
          <span className="pcard-status is-on">{user?.email} · owner</span>
        </span>
      </div>
      <div className="pcard-soon">
        <strong>Organizations are coming soon</strong>
        <p>Share projects and their bridges with your team, invite members, and see who is working on what.</p>
      </div>
    </>
  );
}

function AppearanceSection({ prefs, set }) {
  return (
    <>
      <h3 className="pcard-section">Theme</h3>
      <Row label="Colour theme" hint={prefs.theme === "system" ? `Follows this device (now ${resolvedTheme(prefs)}).` : "Dark uses ChatGPT's dark colours."}>
        <Choice label="Theme" value={prefs.theme} onChange={(v) => set("theme", v)} options={[["light", "Light"], ["dark", "Dark"], ["system", "System"]]} />
      </Row>
      <h3 className="pcard-section">Display</h3>
      <Toggle checked={prefs.reduceMotion} onChange={(v) => set("reduceMotion", v)} label="Reduce motion" hint="No pulsing dots, sliding drawers or animations." />
      <Toggle checked={prefs.compactLists} onChange={(v) => set("compactLists", v)} label="Compact lists" hint="Tighter rows in the Projects and Bridge Spine panes." />
    </>
  );
}

export function SettingsCard({ user, authProvider, onClose }) {
  const prefs = usePreferences();
  const [section, setSection] = useState("general");
  const set = (name, value) => setPreference(name, value);
  const title = SECTIONS.find(([id]) => id === section)[1];

  return (
    <Card title="Settings" subtitle="Saved on this device" onClose={onClose} wide>
      <div className="pcard-settings">
        <nav className="pcard-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label, icon]) => (
            <button key={id} type="button" className={section === id ? "is-on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
              <span className="pcard-nav-icon" aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="pcard-panel" aria-label={title}>
          <h3 className="pcard-panel-title">{title}</h3>
          {section === "general" && <GeneralSection prefs={prefs} set={set} />}
          {section === "projects" && <ProjectsSection prefs={prefs} set={set} />}
          {section === "integrations" && <IntegrationsSection authProvider={authProvider} />}
          {section === "developer" && <DeveloperSection user={user} prefs={prefs} set={set} onReset={resetPreferences} />}
          {section === "organizations" && <OrganizationsSection user={user} />}
          {section === "appearance" && <AppearanceSection prefs={prefs} set={set} />}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Support ---------------- */

const FIXES = [
  ["The interval-end sound doesn't play", "Browsers mute sound until you click the page once. Check Settings → Interval-end sound is on."],
  ["No notification when an interval ends", "Turn on Settings → Desktop notifications and allow notifications for this site in your browser."],
  ["My GitHub repositories don't show", "Sign out, then sign in with GitHub again, and allow access to the organisations you need."],
  ["The Deploy menu is missing", "Continuum Deploy isn't set up for this Continuum yet. Ask the team."],
];

export function SupportCard({ user, authProvider, onClose, onContact }) {
  const navigate = useNavigate();
  const details = diagnostics(user, authProvider);
  return (
    <Card title="Support" subtitle="Help with Continuum" onClose={onClose}>
      <button
        type="button"
        className="pcard-link-row"
        onClick={() => {
          onClose();
          navigate("/help");
        }}
      >
        <span>
          <strong>Help guide</strong>
          <span className="pcard-hint">How intervals, bridges and projects work</span>
        </span>
        <span aria-hidden="true">→</span>
      </button>

      <h3 className="pcard-section">Common fixes</h3>
      <div className="pcard-faq">
        {FIXES.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>

      <h3 className="pcard-section">Report a problem</h3>
      <p className="pcard-text">Tell us what you did and what happened. These details help us find it (no passwords or secrets):</p>
      <pre className="pcard-details">{details}</pre>
      <div className="pcard-actions">
        <CopyButton text={details} label="Copy details" />
        <a className="pcard-btn primary" href={mailto("Problem report: Continuum", `What I did:\n\nWhat happened:\n\n— Details —\n${details}`)}>
          Email the report
        </a>
      </div>
      <p className="pcard-text muted">
        Rather talk?{" "}
        <button type="button" className="pcard-inline" onClick={onContact}>
          Contact us
        </button>
        .
      </p>
    </Card>
  );
}

/* ---------------- Contact us ---------------- */

const TIMES = [
  ["asap", "As soon as possible"],
  ["morning", "Morning (9–12)"],
  ["afternoon", "Afternoon (12–17)"],
  ["evening", "Evening (17–20)"],
];

export function ContactCard({ user, authProvider, onClose }) {
  const [form, setForm] = useState({ name: "", phone: "", bestTime: "asap", note: "" });
  const [state, setState] = useState({ sending: false, sent: null, error: "" });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setState({ sending: true, sent: null, error: "" });
    try {
      await requestCallback({ ...form, timezone });
      setState({ sending: false, sent: form.bestTime, error: "" });
    } catch (err) {
      setState({ sending: false, sent: null, error: err.message || "The request couldn't be sent. Please try again." });
    }
  }

  return (
    <Card title="Contact us" subtitle="Write, call, or let us call you" onClose={onClose}>
      <div className="pcard-options">
        <a className="pcard-option" href={mailto("Hello from Continuum", `\n\n— User ID: ${user?.id ?? "—"} (${authProvider === "github" ? "GitHub" : "email"} sign-in)`)}>
          <span className="pcard-option-icon" aria-hidden="true">✉</span>
          <span>
            <strong>Write to us</strong>
            <span className="pcard-hint">{SUPPORT_EMAIL}</span>
          </span>
        </a>
        {SUPPORT_PHONE ? (
          <a className="pcard-option" href={`tel:${SUPPORT_PHONE.replace(/[^\d+]/g, "")}`}>
            <span className="pcard-option-icon" aria-hidden="true">☎</span>
            <span>
              <strong>Call us</strong>
              <span className="pcard-hint">{SUPPORT_PHONE}</span>
            </span>
          </a>
        ) : (
          <div className="pcard-option is-disabled" aria-disabled="true">
            <span className="pcard-option-icon" aria-hidden="true">☎</span>
            <span>
              <strong>Call us</strong>
              <span className="pcard-hint">Phone support is coming soon: ask for a callback below.</span>
            </span>
          </div>
        )}
      </div>

      <h3 className="pcard-section">Request a callback</h3>
      {state.sent ? (
        <div className="pcard-done" role="status">
          <strong>Thanks, we'll call you.</strong>
          <span className="pcard-hint">
            {TIMES.find(([k]) => k === state.sent)?.[1]} ({timezone}), on {form.phone}.
          </span>
        </div>
      ) : (
        <form className="pcard-form" onSubmit={submit}>
          <label>
            Your name
            <input value={form.name} onChange={set("name")} autoComplete="name" placeholder="Optional" maxLength={100} />
          </label>
          <label>
            Phone number
            <input value={form.phone} onChange={set("phone")} type="tel" autoComplete="tel" placeholder="+91 98765 43210" required />
          </label>
          <label>
            Best time to call
            <select value={form.bestTime} onChange={set("bestTime")}>
              {TIMES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            What it's about
            <textarea value={form.note} onChange={set("note")} rows={3} placeholder="Optional" maxLength={1000} />
          </label>
          {state.error && <p className="pcard-error">{state.error}</p>}
          <div className="pcard-actions">
            <button type="submit" className="pcard-btn primary" disabled={state.sending || !form.phone.trim()}>
              {state.sending ? "Sending…" : "Request a callback"}
            </button>
          </div>
        </form>
      )}
      <p className="pcard-foot">Continuum Console · build {BUILD}</p>
    </Card>
  );
}
