import { useEffect, useRef, useState } from "react";
import {
  playIntervalEndSound,
  showIntervalEndNotification,
} from "../utils/intervalAlerts";

import { formatClock } from "../utils/time";
import { extractTicketKey } from "../utils/ticket";

import { useNavigate } from "react-router-dom";
import { useBrain } from "../brain/brainContext";
import GoalAgents from "../screens/brain/GoalAgents";
import { agentWork, withAgentWork } from "../screens/brain/agentWork";

import "./BridgeDraftModal.css";

const ENDED_TITLE = "⏰ Interval ended · Continuum";

/**
 * BridgeDraftModal
 * ----------------
 * Open for the whole running interval.
 * - Timer counts up (elapsed) from the server's start time, up to the duration.
 * - While running: no footer; a Stop button sits next to the timer.
 *   onStop(bridge) freezes the timer (interval.endedAt set, still a
 *   draft) and the user can still record goals, then save.
 * - When time is up: timer stops, the window pulses, a notification
 *   and chime fire, and "Save & take a break" ends the interval.
 * - onEnd(bridge) saves and finalizes; it throws if the save failed
 *   (err.code "UNAUTHORIZED" when the session has ended).
 * - onSignIn(): signs out so the user can sign in again; the pending
 *   save is completed automatically after sign-in.
 * - Agents: each goal shows the workers on it (click: that worker on the
 *   Agents screen). Stop and save record their work with the goal.
 * - docked (the Agents screen): a panel in the corner instead of a window
 *   over the page, so the agents stay in view; it folds down to the timer.
 * - Minimize (every page): the window becomes a small timer in the corner
 *   that covers nothing; a click opens it again. Remembered per interval;
 *   it opens by itself when time is up.
 */

const minimizedKey = (id) => `continuum.draftMinimized.${id}`;
function readMinimized(id) {
  try {
    return id ? localStorage.getItem(minimizedKey(id)) === "1" : false;
  } catch {
    return false;
  }
}
export default function BridgeDraftModal({ bridge, onUpdate, onStop, onEnd, onSignIn, docked = false }) {
  const brain = useBrain();
  const navigate = useNavigate();
  const liveWorkers = brain?.live.workers ?? [];
  const [folded, setFolded] = useState(false);
  const [minimized, setMinimizedState] = useState(() => readMinimized(bridge?._id));
  function setMinimized(next) {
    setMinimizedState(next);
    try {
      if (next) localStorage.setItem(minimizedKey(bridge?._id), "1");
      else localStorage.removeItem(minimizedKey(bridge?._id));
    } catch {
      // storage unavailable: it just isn't remembered
    }
  }
  function openAgent(agentId) {
    brain?.select(agentId);
    brain?.seek(null);
    navigate("/brain");
  }

  // ✅ Local, authoritative copy
  const [localBridge, setLocalBridge] = useState(bridge);

  // ✅ Resync if a different bridge opens
  useEffect(() => {
    setLocalBridge(bridge);
  }, [bridge]);

  // Another interval: its own minimized state
  useEffect(() => {
    setMinimizedState(readMinimized(bridge?._id));
  }, [bridge?._id]);

  const startedAt = new Date(
    bridge?.interval?.startedAt || bridge?.createdAt || Date.now()
  ).getTime();
  const durationMs = (Number(bridge?.interval?.duration) || 0) * 60 * 1000;
  const endsAt = startedAt + durationMs;
  const hasTimer = durationMs > 0;

  // Stopped by the user (Stop button): interval.endedAt is set while the
  // bridge is still a draft. Survives reloads.
  const stoppedAtRaw = localBridge?.interval?.endedAt;
  const stoppedAt = stoppedAtRaw ? new Date(stoppedAtRaw).getTime() : null;

  const [now, setNow] = useState(() => Date.now());
  const effectiveNow = stoppedAt ?? now;
  const stopped = hasTimer && stoppedAt !== null;
  const expired = hasTimer && !stopped && now >= endsAt;
  const running = hasTimer && !stopped && !expired;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // Alert only if the interval ends while this window is open,
  // not when an already-ended draft is resumed after a reload
  const endedBeforeOpen = useRef(hasTimer && Date.now() >= endsAt);
  const alerted = useRef(false);

  // Tick once per second until the interval ends. Browsers slow timers
  // in background tabs, so also refresh as soon as the tab is visible.
  useEffect(() => {
    if (!running) return;

    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);

  // Time's up: notification + chime (once), and the window opens to be saved
  useEffect(() => {
    if (!expired || endedBeforeOpen.current || alerted.current) return;
    alerted.current = true;
    setMinimizedState(false);
    playIntervalEndSound();
    showIntervalEndNotification(bridge?.name ?? "Your interval");
  }, [expired, bridge?.name]);

  // Time's up: tab title, restored when the window closes
  useEffect(() => {
    if (!expired) return;
    const previousTitle = document.title;
    document.title = ENDED_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, [expired]);

  if (!localBridge) return null;

  const sessionGoals = localBridge.sessionGoals ?? [];

  function updateGoalStatus(id, status) {
    const updated = {
      ...localBridge,
      sessionGoals: sessionGoals.map((g) =>
        g.id === id ? { ...g, status } : g
      ),
    };

    // 1️⃣ Update UI immediately
    setLocalBridge(updated);

    // 2️⃣ Bubble change upward (App will persist)
    onUpdate(updated);
  }

  // Stop: freeze the timer now; goals can still be recorded and saved
  function handleStop() {
    const updated = withAgentWork(
      {
        ...localBridge,
        interval: {
          ...localBridge.interval,
          endedAt: new Date().toISOString(),
        },
      },
      liveWorkers
    );

    setLocalBridge(updated);
    onStop(updated);
  }

  async function handleEnd() {
    setError("");
    setNeedsSignIn(false);
    setSaving(true);

    try {
      await onEnd(withAgentWork(localBridge, liveWorkers));
    } catch (err) {
      if (err?.code === "UNAUTHORIZED") {
        setNeedsSignIn(true);
        setError(
          "Your session has ended. Sign in to finish saving — your changes are kept."
        );
      } else {
        setError(
          "Couldn't reach the server. Your changes are kept — please try again."
        );
      }
      setSaving(false);
    }
  }

  const elapsedMs = Math.min(durationMs, Math.max(0, effectiveNow - startedAt));
  const progress = hasTimer ? (elapsedMs / durationMs) * 100 : 0;

  // Minimized: a small timer in the corner, covering nothing
  if (minimized) {
    return (
      <div className="bridge-draft-pill">
        <button type="button" className={`draft-pill-open${expired ? " is-ended" : ""}`} onClick={() => setMinimized(false)} title="Open the running interval">
          <span className={`draft-pill-dot${running ? " is-running" : ""}`} aria-hidden="true" />
          {hasTimer && <span className="draft-pill-clock">{formatClock(elapsedMs)}</span>}
          <span className="draft-pill-meta">
            {expired ? "Time's up" : stopped ? "Stopped" : hasTimer ? `of ${formatClock(durationMs)}` : "Interval"} · {sessionGoals.length} {sessionGoals.length === 1 ? "goal" : "goals"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={docked ? "bridge-draft-dock" : "modal-backdrop"}>
      <div className={`modal-window bridge-draft${expired ? " bridge-draft-ended" : ""}${docked ? " docked" : ""}${docked && folded ? " folded" : ""}`}>

        <header className="modal-header">
          <h2>{localBridge.name ?? "Bridge Draft"}</h2>
          {docked && (
            <button type="button" className="draft-fold-btn" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} title={folded ? "Show the goals" : "Fold down to the timer"}>
              {folded ? "▴" : "▾"}
            </button>
          )}
          <button type="button" className="draft-fold-btn" onClick={() => setMinimized(true)} title="Minimize: keep the timer in a corner" aria-label="Minimize the interval">
            –
          </button>
        </header>

        <section className="modal-body">

          {hasTimer && (
            <div className="draft-timer" aria-live="polite">
              <div className="draft-timer-row">
                <div className="draft-timer-clock">
                  {formatClock(elapsedMs)}
                </div>

                {running && (
                  <button
                    type="button"
                    className="draft-stop-btn"
                    onClick={handleStop}
                    title="Stop the timer"
                  >
                    ■ Stop
                  </button>
                )}
              </div>
              <div className="draft-timer-label">
                {expired ? "Time's up" : stopped ? "Stopped" : "elapsed"}
              </div>

              <div className="draft-timer-bar">
                <div
                  className="draft-timer-bar-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="draft-timer-elapsed">
                of {formatClock(durationMs)} interval duration
              </div>
            </div>
          )}

          {expired && (
            <p className="draft-break">
              Time's up. Record what happened, save, and take a break.
            </p>
          )}

          {stopped && (
            <p className="draft-stopped">
              Interval stopped. Record what happened, then save and take a break.
            </p>
          )}

          <p className="modal-meta">
            Mark what happened in this interval.
          </p>

          {localBridge.ticketUrl && (
            <p className="bridge-ticket">
              <strong>Ticket:</strong>{" "}
              <a
                href={localBridge.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ticket-badge"
                title={localBridge.ticketUrl}
              >
                {extractTicketKey(localBridge.ticketUrl)}
              </a>
            </p>
          )}

          <ul className="goal-list">
            {sessionGoals.map((g) => (
              <li key={g.id}>
                <span className="goal-text">
                  {g.text}
                  <GoalAgents agents={brain ? agentWork(liveWorkers, localBridge._id, g.id) : g.agents} onOpen={brain ? openAgent : undefined} />
                </span>

                <select
                  value={g.status}
                  onChange={(e) =>
                    updateGoalStatus(g.id, e.target.value)
                  }
                >
                  <option value="untouched">Untouched</option>
                  <option value="completed">Completed</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </li>
            ))}
          </ul>

          <div className="bridge-times">
            <div className="bridge-time-row">
              <span className="bridge-time-label">Started</span>
              <span className="bridge-time-value">
                {new Date(localBridge.interval?.startedAt || localBridge.createdAt).toLocaleString()}
              </span>
            </div>
          </div>

          {error && <p className="draft-error">{error}</p>}

        </section>

        {/* No footer while the timer runs — Stop is next to the timer */}
        {!running && (
        <footer className="modal-footer draft-footer">
          {needsSignIn ? (
            <button className="draft-btn-primary" onClick={onSignIn}>
              Sign in to finish saving
            </button>
          ) : (
            <button
              className="draft-btn-primary"
              onClick={handleEnd}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save & take a break"}
            </button>
          )}
        </footer>
        )}

      </div>
    </div>
  );
}
