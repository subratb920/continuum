import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBridges } from "../api";
import { assertBridge } from "../utils/assertBridge";
import { normalizeBridge } from "../utils/normalizeBridge";
import { formatDuration, formatTimeOfDay } from "../utils/time";
import { usePreferences } from "../utils/preferences";

import "./BridgeSpine.css";

const MODE_LABEL = { execution: "Execution", decision: "Decision", continuity: "Continuity", alignment: "Alignment" };

/** "Today", "Yesterday" or "13 Oct" (with the year when it isn't this one). */
function dayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

const timeOf = (date) => formatTimeOfDay(date);
const startOfBridge = (b) => b.interval.startedAt ?? b.createdAt;

/**
 * Bridge Spine: the selected project's bridges (one per interval) as a
 * timeline, newest first, grouped by day. The bridge still in progress
 * (a draft) comes first; the current one is highlighted.
 */
export default function BridgeSpine({
  selectedProject,
  activeBridge,
  bridgeRevision,
  onSelectBridge,
}) {
  const [retry, setRetry] = useState(0);
  // The last answer: which project it is for, its bridges, or that it failed
  const [result, setResult] = useState({ projectId: null, bridges: [], failed: false });

  /* =========================================================
     🔁 Load bridges for selected project
     - Normalize at API boundary (CRITICAL)
     - Assert canonical model only
     - Prevent malformed legacy data from entering UI
     ========================================================= */
  useEffect(() => {
    if (!selectedProject) return;

    let currentRequest = true;
    const projectId = selectedProject._id;

    async function loadBridges() {
      try {
        const data = await fetchBridges(projectId);

        if (!currentRequest) return; // 🔥 ignore stale response

        const normalized = data.map((bridge) => normalizeBridge(bridge));

        normalized.forEach(assertBridge);

        setResult({ projectId, bridges: normalized, failed: false });
      } catch (err) {
        console.error("Failed to load bridges", err);
        if (currentRequest) setResult({ projectId, bridges: [], failed: true });
      }
    }

    loadBridges();

    return () => {
      currentRequest = false; // 🔥 invalidate previous request
    };
  }, [selectedProject, bridgeRevision, retry]);

  // Another project's (or no) answer yet: loading; a refresh of the same project keeps showing its bridges
  const mine = selectedProject && result.projectId === selectedProject._id;
  const bridges = useMemo(() => (mine ? result.bridges : []), [mine, result.bridges]);
  const state = !selectedProject ? "idle" : !mine ? "loading" : result.failed ? "error" : "ready";

  /* =========================================================
     📐 Newest first; the one in progress on top; grouped by day
     ========================================================= */
  const groups = useMemo(() => {
    const inProgress = bridges.filter((b) => b.status === "draft");
    const done = bridges
      .filter((b) => b.status !== "draft")
      .sort((a, b) => new Date(startOfBridge(b)) - new Date(startOfBridge(a)) || (b.index ?? 0) - (a.index ?? 0));
    const out = [];
    if (inProgress.length) out.push({ label: "In progress", bridges: inProgress });
    for (const b of done) {
      const label = dayLabel(startOfBridge(b));
      if (out.at(-1)?.label === label) out.at(-1).bridges.push(b);
      else out.push({ label, bridges: [b] });
    }
    return out;
  }, [bridges]);

  const tryAgain = useCallback(() => setRetry((n) => n + 1), []);

  return (
    <div className="bridge-spine">
      <div className="bridge-spine-head">
        <h2 className="bridge-spine-title">
          Bridge Spine
          {bridges.length > 0 && <span className="bridge-count">{bridges.length}</span>}
        </h2>
        {selectedProject && <div className="bridge-spine-project" title={selectedProject.name}>{selectedProject.name}</div>}
      </div>

      {!selectedProject && <p className="bridge-empty">Choose a project to see its bridges.</p>}
      {selectedProject && state === "loading" && <p className="bridge-empty">Loading…</p>}
      {selectedProject && state === "error" && (
        <div className="bridge-empty bridge-error">
          <p>The bridges couldn't be loaded.</p>
          <button type="button" className="bridge-retry" onClick={tryAgain}>
            Try again
          </button>
        </div>
      )}
      {selectedProject && state === "ready" && bridges.length === 0 && (
        <p className="bridge-empty">No intervals yet — start one from Interval Setup.</p>
      )}

      {state === "ready" && groups.length > 0 && (
        <div className="bridge-timeline">
          {groups.map((group) => (
            <section key={group.label} className="bridge-group" aria-label={group.label}>
              <h3 className="bridge-day">{group.label}</h3>
              <ol className="bridge-list">
                {group.bridges.map((bridge) => (
                  <BridgeCard key={bridge._id} bridge={bridge} isActive={activeBridge?._id === bridge._id} onSelect={() => onSelectBridge(bridge)} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function BridgeCard({ bridge, isActive, onSelect }) {
  usePreferences(); // re-render when the clock format changes
  const goals = bridge.sessionGoals;
  const completed = goals.filter((g) => g.status === "completed").length;
  const mode = String(bridge.interval.mode ?? "").toLowerCase(); // stored as "Execution", "Alignment" …
  const inProgress = bridge.status === "draft";
  const state = inProgress ? "in-progress" : bridge.status; // finalized | abandoned

  return (
    <li className={`bridge-entry bridge-${state}${isActive ? " is-current" : ""}`}>
      <span className="bridge-dot" aria-hidden="true" />
      <div className="bridge-card">
        <button type="button" className="bridge-open" onClick={onSelect} aria-current={isActive ? "true" : undefined} title={`Open ${bridge.name}`}>
          <span className="bridge-top">
            <span className="bridge-name">{bridge.name}</span>
            {MODE_LABEL[mode] && <span className={`bridge-mode mode-${mode}`}>{MODE_LABEL[mode]}</span>}
          </span>

          <span className="bridge-when">
            {timeOf(startOfBridge(bridge))}
            {bridge.interval.duration > 0 && ` · ${formatDuration(bridge.interval.duration)}`}
            {inProgress && <span className="bridge-state state-progress"> · In progress</span>}
            {bridge.status === "abandoned" && <span className="bridge-state state-abandoned"> · Abandoned</span>}
          </span>

          {goals.length > 0 && (
            <span className="bridge-goals" title={`${completed} of ${goals.length} goals completed`}>
              <span className="bridge-goals-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((completed / goals.length) * 100)}%` }} />
              </span>
              <span className="bridge-goals-text">
                {completed} / {goals.length} goal{goals.length === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </button>

        {bridge.ticketUrl && (
          <a className="bridge-card-ticket" href={bridge.ticketUrl} target="_blank" rel="noopener noreferrer" title="Open its ticket or story" aria-label={`Open the ticket of ${bridge.name}`}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" />
            </svg>
          </a>
        )}
      </div>
    </li>
  );
}
