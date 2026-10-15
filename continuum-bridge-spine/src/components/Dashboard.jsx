import { useEffect, useMemo, useRef, useState } from "react";
import { fetchBridges } from "../api";
import { normalizeBridge } from "../utils/normalizeBridge";
import { formatDuration, formatTimeOfDay } from "../utils/time";
import { usePreferences } from "../utils/preferences";
import "./Dashboard.css";

/** The Dashboard's sections, for its navigation pane. */
const DASHBOARD_SECTIONS = [
  ["dash-overview", "Overview", "◉"],
  ["dash-week", "This week", "▥"],
  ["dash-modes", "Modes", "◔"],
  ["dash-recent", "Recent intervals", "↺"],
  ["dash-projects", "Projects", "▤"],
];

/**
 * The Dashboard's navigation (the console's left pane while it shows): its
 * sections, the one in view highlighted; Interval Setup to go back.
 */
export function DashboardNav({ onIntervalSetup, onNavigate }) {
  const [current, setCurrent] = useState(DASHBOARD_SECTIONS[0][0]);
  // After a click, the clicked section stays highlighted while the pane scrolls to it
  // (a short page can't bring its last sections to the top, so position alone would mislead)
  const clickedUntil = useRef(0);

  // The section in view: the last one whose top has passed the top of the middle pane
  useEffect(() => {
    const pane = document.querySelector(".app > .center");
    if (!pane) return;
    const look = () => {
      if (Date.now() < clickedUntil.current) return;
      const top = pane.getBoundingClientRect().top + 80;
      let seen = DASHBOARD_SECTIONS[0][0];
      for (const [id] of DASHBOARD_SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) seen = id;
      }
      // Scrolled to the end: the last section counts
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) seen = DASHBOARD_SECTIONS.at(-1)[0];
      setCurrent(seen);
    };
    pane.addEventListener("scroll", look, { passive: true });
    const t = setTimeout(look, 300); // after the data has drawn
    return () => {
      pane.removeEventListener("scroll", look);
      clearTimeout(t);
    };
  }, []);

  return (
    <nav className="dash-nav" aria-label="Dashboard">
      <h2 className="dash-nav-title">Dashboard</h2>
      <ul>
        {DASHBOARD_SECTIONS.map(([id, label, icon]) => (
          <li key={id}>
            <button
              type="button"
              className={current === id ? "is-on" : ""}
              aria-current={current === id ? "true" : undefined}
              onClick={() => {
                clickedUntil.current = Date.now() + 1200;
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                setCurrent(id);
                onNavigate?.();
              }}
            >
              <span className="dash-nav-icon" aria-hidden="true">{icon}</span>
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div className="dash-nav-sep" />
      <button type="button" className="dash-nav-back" onClick={onIntervalSetup}>
        <span className="dash-nav-icon" aria-hidden="true">←</span>
        Interval Setup
      </button>
    </nav>
  );
}

const MODES = [
  ["execution", "Execution"],
  ["decision", "Decision"],
  ["continuity", "Continuity"],
  ["alignment", "Alignment"],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const startOf = (b) => new Date(b.interval.startedAt ?? b.createdAt);
const modeOf = (b) => String(b.interval.mode ?? "").toLowerCase();

/** Monday 00:00 of this week. */
function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function when(date) {
  const d = new Date(date);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day}, ${formatTimeOfDay(d)}`;
}

/**
 * Dashboard: an overview of all projects and intervals, shown in the
 * console's middle pane (the Projects and Bridge Spine panes stay).
 * Built from the projects and their bridges; nothing new is stored.
 */
export default function Dashboard({ projects, activeProject, activeBridge, bridgeRevision, onSelectProject, onOpenInterval }) {
  usePreferences(); // times follow the clock setting
  const [data, setData] = useState(null); // { bridges: [{ ...bridge, project }], failed: n }
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    Promise.allSettled(projects.map((p) => fetchBridges(p._id).then((list) => list.map((b) => ({ ...normalizeBridge(b), project: p })))))
      .then((results) => {
        if (!live) return;
        const bridges = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        setData({ bridges, failed: results.filter((r) => r.status === "rejected").length });
      });
    return () => {
      live = false;
    };
  }, [projects, bridgeRevision]);

  // The interval in progress counts down
  useEffect(() => {
    if (!activeBridge) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [activeBridge]);

  const stats = useMemo(() => {
    if (!data) return null;
    const all = data.bridges;
    const week = weekStart();
    const thisWeek = all.filter((b) => startOf(b) >= week);
    const goals = all.flatMap((b) => b.sessionGoals);
    const done = goals.filter((g) => g.status === "completed").length;
    const perDay = DAYS.map((_, i) => thisWeek.filter((b) => (startOf(b).getDay() + 6) % 7 === i).length);
    const modes = MODES.map(([k, label]) => ({ k, label, n: all.filter((b) => modeOf(b) === k).length }));
    const recent = [...all].sort((a, b) => startOf(b) - startOf(a)).slice(0, 8);
    const byProject = projects
      .map((p) => {
        const mine = all.filter((b) => b.project._id === p._id);
        const last = mine.reduce((m, b) => Math.max(m, startOf(b).getTime()), 0);
        return { project: p, count: mine.length, last: last || null };
      })
      .sort((a, b) => b.count - a.count || (b.last ?? 0) - (a.last ?? 0));
    return {
      total: all.length,
      week: thisWeek.length,
      weekMinutes: thisWeek.reduce((m, b) => m + (b.interval.duration || 0), 0),
      goalsTotal: goals.length,
      goalsDone: done,
      perDay,
      modes,
      recent,
      byProject,
    };
  }, [data, projects]);

  const today = (new Date().getDay() + 6) % 7;

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>Dashboard</h1>
          <p>{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
      </header>

      {/* Now */}
      <section className="dash-now" aria-label="Now" id="dash-overview">
        {activeBridge ? (
          <>
            <span className="dash-live-dot" aria-hidden="true" />
            <div className="dash-now-text">
              <span className="dash-label">In progress</span>
              <strong>
                {activeBridge.name} · {activeProject?.name}
              </strong>
              <span className="dash-muted">{nowLine(activeBridge, now)}</span>
            </div>
            <button type="button" className="dash-btn primary" onClick={onOpenInterval}>
              Open
            </button>
          </>
        ) : (
          <>
            <span className="dash-idle-dot" aria-hidden="true" />
            <div className="dash-now-text">
              <span className="dash-label">{activeProject ? "Active project" : "No active project"}</span>
              <strong>{activeProject ? activeProject.name : "Activate a project to start intervals"}</strong>
              <span className="dash-muted">No interval running.</span>
            </div>
            <button type="button" className="dash-btn" onClick={onOpenInterval}>
              Interval Setup
            </button>
          </>
        )}
      </section>

      {!stats ? (
        <p className="dash-muted dash-loading">Loading your intervals…</p>
      ) : (
        <>
          {data.failed > 0 && <p className="dash-warn">The intervals of {data.failed} project{data.failed === 1 ? "" : "s"} couldn't be loaded; the numbers leave them out.</p>}

          {/* At a glance */}
          <section className="dash-tiles" aria-label="At a glance">
            <Tile label="Projects" value={projects.length} sub={`${stats.total} interval${stats.total === 1 ? "" : "s"} in all`} />
            <Tile label="Intervals this week" value={stats.week} sub={`since Monday`} />
            <Tile label="Goals completed" value={stats.goalsTotal ? `${Math.round((stats.goalsDone / stats.goalsTotal) * 100)}%` : "—"} sub={`${stats.goalsDone} of ${stats.goalsTotal}`} />
            <Tile label="Focus time this week" value={stats.weekMinutes ? formatDuration(stats.weekMinutes) : "—"} sub="planned" />
          </section>

          <div className="dash-grid">
            {/* This week */}
            <section className="dash-card" aria-label="This week" id="dash-week">
              <h2>This week</h2>
              <div className="dash-bars">
                {stats.perDay.map((n, i) => {
                  const max = Math.max(1, ...stats.perDay);
                  return (
                    <div key={DAYS[i]} className={`dash-bar${i === today ? " is-today" : ""}`} title={`${DAYS[i]}: ${n} interval${n === 1 ? "" : "s"}`}>
                      <span className="dash-bar-n">{n || ""}</span>
                      <span className="dash-bar-fill" style={{ height: `${(n / max) * 100}%` }} />
                      <span className="dash-bar-day">{DAYS[i]}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Modes */}
            <section className="dash-card" aria-label="Modes" id="dash-modes">
              <h2>Modes</h2>
              {stats.total === 0 ? (
                <p className="dash-muted">No intervals yet.</p>
              ) : (
                <ul className="dash-modes">
                  {stats.modes.map((m) => (
                    <li key={m.k}>
                      <span className={`dash-mode mode-${m.k}`}>{m.label}</span>
                      <span className="dash-mode-bar">
                        <span className={`fill-${m.k}`} style={{ width: `${(m.n / stats.total) * 100}%` }} />
                      </span>
                      <span className="dash-mode-n">{m.n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="dash-grid">
            {/* Recent intervals */}
            <section className="dash-card" aria-label="Recent intervals" id="dash-recent">
              <h2>Recent intervals</h2>
              {stats.recent.length === 0 ? (
                <p className="dash-muted">No intervals yet: start one from Interval Setup.</p>
              ) : (
                <ul className="dash-list">
                  {stats.recent.map((b) => {
                    const g = b.sessionGoals;
                    const done = g.filter((x) => x.status === "completed").length;
                    return (
                      <li key={b._id}>
                        <button type="button" onClick={() => onSelectProject(b.project)} title={`Show ${b.project.name}'s bridges`}>
                          <span className="dash-list-main">
                            <strong>{b.name}</strong>
                            <span className="dash-muted">{b.project.name}</span>
                          </span>
                          <span className="dash-list-side">
                            <span>{when(startOf(b))}</span>
                            <span className="dash-muted">
                              {b.status === "draft" ? "in progress" : b.status === "abandoned" ? "abandoned" : g.length ? `${done}/${g.length} goals` : "no goals"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Projects */}
            <section className="dash-card" aria-label="Projects" id="dash-projects">
              <h2>Projects</h2>
              <ul className="dash-list">
                {stats.byProject.slice(0, 8).map(({ project, count, last }) => (
                  <li key={project._id}>
                    <button type="button" onClick={() => onSelectProject(project)}>
                      <span className="dash-list-main">
                        <strong>
                          {project.name}
                          {activeProject?._id === project._id && <span className="dash-active">Active</span>}
                        </strong>
                        <span className="dash-muted">{last ? `last used ${when(last)}` : "not used yet"}</span>
                      </span>
                      <span className="dash-count">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="dash-tile">
      <span className="dash-label">{label}</span>
      <strong>{value}</strong>
      <span className="dash-muted">{sub}</span>
    </div>
  );
}

/** "Execution · 30 min · 12 min left" (or "time's up"). */
function nowLine(b, now) {
  const parts = [];
  const mode = MODES.find(([k]) => k === modeOf(b))?.[1];
  if (mode) parts.push(mode);
  if (b.interval.duration) parts.push(formatDuration(b.interval.duration));
  if (b.interval.startedAt && b.interval.duration) {
    const left = Math.round((new Date(b.interval.startedAt).getTime() + b.interval.duration * 60_000 - now) / 60_000);
    parts.push(left > 0 ? `${left} min left` : "time's up");
  }
  return parts.join(" · ");
}
