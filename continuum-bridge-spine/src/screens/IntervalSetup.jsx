import React, { useState } from "react";
import { startInterval } from "../api";

export default function IntervalSetup({
  activeProject,
  onIntervalStarted,
}) {
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState([]);
  const [mode, setMode] = useState("Build");
  const [duration, setDuration] = useState(30);

  // ------------------------------
  // Session Goal Handling
  // ------------------------------

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

  // ------------------------------
  // Interval Start
  // ------------------------------

  async function handleStartInterval() {
    // 🔒 Hard guard (model invariant)
    if (goals.length === 0) return;

    const bridge = await startInterval({
      projectId: activeProject._id,
      mode,
      duration,
      sessionGoals: goals.map((g) => g.text),
    });

    // 🔑 Propagate to App
    onIntervalStarted(bridge);
  }

  // ------------------------------
  // UI
  // ------------------------------

  return (
    <div className="content">
      <h2>INTERVAL SETUP</h2>

      {/* Interval Mode */}
      <section>
        <h3>Interval Mode</h3>
        {["Build", "Refactor", "Explore", "Stabilize"].map((m) => (
          <label key={m} style={{ marginRight: "12px" }}>
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

      {/* Session Goals */}
      <section>
        <h3>Session Goals</h3>

        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Add a session goal"
          />
          <button type="button" onClick={addGoal}>
            Add
          </button>
        </div>

        {goals.length > 0 && (
          <ul>
            {goals.map((g) => (
              <li key={g.id}>{g.text}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Interval Length */}
      <section>
        <h3>Interval Length</h3>
        {[30, 45].map((d) => (
          <label key={d} style={{ marginRight: "12px" }}>
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

      {/* Guidance */}
      {goals.length === 0 && (
        <p className="hint">
          Add at least one session goal to start an interval
        </p>
      )}

      {/* Start Interval */}
      <button
        type="button"
        className="primary"
        onClick={handleStartInterval}
        disabled={goals.length === 0}
      >
        Start Interval
      </button>
    </div>
  );
}
