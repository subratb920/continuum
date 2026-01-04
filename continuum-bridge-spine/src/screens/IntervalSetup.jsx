import { useState } from "react";

export default function IntervalSetup() {
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState([]);

  function addGoal() {
    if (!goalInput.trim()) return;

    setGoals([
      ...goals,
      {
        id: crypto.randomUUID(),
        text: goalInput.trim()
      }
    ]);

    setGoalInput("");
  }

  return (
    <div className="content">
      <h2>INTERVAL SETUP</h2>

      {/* Interval Mode */}
      <section>
        <h3>Interval Mode</h3>
        <label>
          <input type="radio" name="mode" defaultChecked /> Build
        </label>
        <label>
          <input type="radio" name="mode" /> Refactor
        </label>
        <label>
          <input type="radio" name="mode" /> Explore
        </label>
        <label>
          <input type="radio" name="mode" /> Stabilize
        </label>
      </section>

      {/* Session Goals Input */}
      <section>
        <h3>Session Goals</h3>

        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Add a session goal"
            style={{ flex: 1, padding: "8px" }}
          />
          <button onClick={addGoal}>Add</button>
        </div>

        {goals.length > 0 && (
          <ul>
            {goals.map((goal) => (
              <li key={goal.id}>{goal.text}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Interval Length */}
      <section>
        <h3>Interval Length</h3>
        <label>
          <input type="radio" name="length" defaultChecked /> 30 min
        </label>
        <label>
          <input type="radio" name="length" /> 45 min
        </label>
      </section>

      {/* Start Interval */}
      <button
        className="primary"
        disabled={goals.length === 0}
      >
        Start Interval
      </button>
    </div>
  );
}
