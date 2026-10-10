import { useEffect, useRef, useState } from "react";
import {
  playIntervalEndSound,
  showIntervalEndNotification,
} from "../utils/intervalAlerts";

import "./BridgeDraftModal.css";

const ENDED_TITLE = "⏰ Interval ended · Continuum";

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * BridgeDraftModal
 * ----------------
 * Open for the whole running interval.
 * - Timer counts down from the server's start time and duration.
 * - While running: no footer; a Stop button sits next to the timer.
 *   onStop(bridge) freezes the timer (interval.endedAt set, still a
 *   draft) and the user can still record goals, then save.
 * - When time is up: timer stops, the window pulses, a notification
 *   and chime fire, and "Save & take a break" ends the interval.
 * - onEnd(bridge) saves and finalizes; it throws if the save failed
 *   (err.code "UNAUTHORIZED" when the session has ended).
 * - onSignIn(): signs out so the user can sign in again; the pending
 *   save is completed automatically after sign-in.
 */
export default function BridgeDraftModal({ bridge, onUpdate, onStop, onEnd, onSignIn }) {
  // ✅ Local, authoritative copy
  const [localBridge, setLocalBridge] = useState(bridge);

  // ✅ Resync if a different bridge opens
  useEffect(() => {
    setLocalBridge(bridge);
  }, [bridge]);

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

  // Time's up: notification + chime (once)
  useEffect(() => {
    if (!expired || endedBeforeOpen.current || alerted.current) return;
    alerted.current = true;
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
    const updated = {
      ...localBridge,
      interval: {
        ...localBridge.interval,
        endedAt: new Date().toISOString(),
      },
    };

    setLocalBridge(updated);
    onStop(updated);
  }

  async function handleEnd() {
    setError("");
    setNeedsSignIn(false);
    setSaving(true);

    try {
      await onEnd(localBridge);
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

  const remainingMs = Math.min(durationMs, Math.max(0, endsAt - effectiveNow));
  const elapsedMs = Math.min(durationMs, Math.max(0, effectiveNow - startedAt));
  const progress = hasTimer ? (elapsedMs / durationMs) * 100 : 0;

  return (
    <div className="modal-backdrop">
      <div className={`modal-window bridge-draft${expired ? " bridge-draft-ended" : ""}`}>

        <header className="modal-header">
          <h2>{localBridge.name ?? "Bridge Draft"}</h2>
        </header>

        <section className="modal-body">

          {hasTimer && (
            <div className="draft-timer" aria-live="polite">
              <div className="draft-timer-row">
                <div className="draft-timer-remaining">
                  {formatClock(remainingMs)}
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
                {expired ? "Time's up" : stopped ? "Stopped" : "remaining"}
              </div>

              <div className="draft-timer-bar">
                <div
                  className="draft-timer-bar-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="draft-timer-elapsed">
                {formatClock(elapsedMs)} / {formatClock(durationMs)}
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
              >
                {localBridge.ticketUrl}
              </a>
            </p>
          )}

          <ul className="goal-list">
            {sessionGoals.map((g) => (
              <li key={g.id}>
                <span>{g.text}</span>

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
