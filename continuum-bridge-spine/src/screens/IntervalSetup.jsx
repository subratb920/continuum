import React, { useState } from "react";
import { startInterval } from "../api";
import "./IntervalSetup.css";

/**
 * IntervalSetup
 * -------------
 * Execution gatekeeper for Continuum.
 *
 * Rules:
 * - Interval can ONLY be started for the active project
 * - Viewing ≠ Activation
 * - UI must clearly explain disabled state
 */
export default function IntervalSetup({
  activeProject,
  selectedProject,
  onIntervalStarted,
}) {
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState([]);
  const [mode, setMode] = useState("Execution");
  const [duration, setDuration] = useState(30);

  // --------------------------------------------------
  // Execution invariant
  // --------------------------------------------------
  const isExecutable =
    activeProject &&
    selectedProject &&
    activeProject._id === selectedProject._id;

  // --------------------------------------------------
  // Session Goals
  // --------------------------------------------------
  function addGoal() {
    if (!goalInput.trim()) return;

    setGoals((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: goalInput.trim(),
      },
    ]);

    setGoalInput("");
  }

  function removeGoal(id) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  // --------------------------------------------------
  // Start Interval
  // --------------------------------------------------
  async function handleStartInterval() {
    // 🔒 UI guard (backend also enforces)
    if (!isExecutable) return;
    if (goals.length === 0) return;

    const bridge = await startInterval({
      projectId: activeProject._id,
      mode,
      duration,
      sessionGoals: goals.map((g) => g.text),
    });

    // Reset local state after interval creation
    setGoals([]);
    setGoalInput("");

    onIntervalStarted(bridge);
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  return (
    <div className="interval-setup">
      <h2 className="interval-title">
        Interval Setup
        {!isExecutable && selectedProject && (
          <span className="inactive-tag"> · inactive project</span>
        )}
      </h2>

      {/* --------------------------------------------------
          Disabled wrapper when not executable
         -------------------------------------------------- */}
      <fieldset
        disabled={!isExecutable}
        className={!isExecutable ? "disabled" : ""}
      >
        {/* -------- Interval Mode -------- */}
        <section className="interval-section">
          <h3>Interval Mode</h3>
          {["Decision", "Execution", "Continuity", "Alignment"].map((m) => (
            <label key={m} className="radio">
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m}
            </label>
          ))}
        </section>

        {/* -------- Session Goals -------- */}
        <section className="interval-section">
          <h3>Session Goals</h3>

          <div className="goal-input-row">
            <textarea
              className="goal-textarea"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="Describe what you want to achieve in this interval…"
              rows={4}
            />
            <button type="button" onClick={addGoal}>
              Add
            </button>
          </div>

          {goals.length > 0 && (
            <ol className="session-goals">
              {goals.map((g, index) => (
                <li key={g.id} className="session-goal-item">
                  <span className="goal-text">{g.text}</span>
                  <button
                    className="goal-remove"
                    onClick={() => removeGoal(g.id)}
                    aria-label={`Remove goal ${index + 1}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* -------- Interval Length -------- */}
        <section className="interval-section">
          <h3>Interval Length</h3>
          {[30, 45].map((d) => (
            <label key={d} className="radio">
              <input
                type="radio"
                name="duration"
                checked={duration === d}
                onChange={() => setDuration(d)}
              />
              {d} min
            </label>
          ))}
        </section>
      </fieldset>

      {/* --------------------------------------------------
          Guidance
         -------------------------------------------------- */}
      {!isExecutable && selectedProject && (
        <p className="hint warning">
          This project is not currently active.
          Activate it to start a new interval.
        </p>
      )}

      {isExecutable && goals.length === 0 && (
        <p className="hint">
          Add at least one session goal to start an interval.
        </p>
      )}

      {/* --------------------------------------------------
          Action
         -------------------------------------------------- */}
      <button
        type="button"
        className="primary"
        onClick={handleStartInterval}
        disabled={!isExecutable || goals.length === 0}
      >
        Start Interval
      </button>
    </div>
  );
}
