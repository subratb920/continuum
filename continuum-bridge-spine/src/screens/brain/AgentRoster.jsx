import { useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES, STATE_LABEL } from "../../brain/brainTypes";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { agentName, elapsed, useNow } from "./agentDisplay";
import "./brain.css";

/**
 * Agents pane (left): the core, then its workers, each with its state, task,
 * the interval goal it works on, branch and running time. Spawn starts a
 * worker through the core (on one of the running interval's goals, if you
 * pick one); a failed worker can be retried. While replaying, the actions wait.
 */
export default function AgentRoster() {
  const brain = useBrain();
  const now = useNow();
  const [spawning, setSpawning] = useState(false);
  const [task, setTask] = useState("");
  const [goalId, setGoalId] = useState("");

  if (!brain) return null;
  const { core, workers, pending, selectedId, select, stop, retry, replay, interval } = brain;
  const asking = new Set(pending.map((e) => e.agentId));
  const clockNow = replay.live ? now : replay.at;
  const goals = interval?.goals ?? [];

  function submit(e) {
    e.preventDefault();
    const goal = goals.find((g) => g.id === goalId);
    const text = task.trim() || goal?.text;
    if (!text) return;
    brain.spawn(text, { goal: goal ? { bridgeId: interval.bridgeId, goalId: goal.id, text: goal.text } : null });
    setTask("");
    setGoalId("");
    setSpawning(false);
  }

  const row = (a) => {
    const active = ACTIVE_STATES.includes(a.state);
    return (
      <li key={a._id}>
        <div
          role="button"
          tabIndex={0}
          className={`agent-row state-${a.state}${selectedId === a._id ? " selected" : ""}${asking.has(a._id) ? " asking" : ""}`}
          onClick={() => select(selectedId === a._id ? null : a._id)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(a._id))}
        >
          <span className="agent-dot" aria-hidden="true" />
          <span className="agent-row-main">
            <span className="agent-row-top">
              <span className="agent-row-name">{agentName(a, workers)}</span>
              <span className="agent-row-state">{asking.has(a._id) ? "Needs you" : STATE_LABEL[a.state]}</span>
              <span className="agent-row-time">{elapsed(a.startedAt, a.finishedAt ?? clockNow)}</span>
            </span>
            <span className="agent-row-task" title={a.task}>{a.task}</span>
            {a.goal && (
              <span className="agent-row-goal" title={`Interval goal: ${a.goal.text}`}>
                ◎ {a.goal.text}
              </span>
            )}
            {a.retryOf && <span className="agent-row-note">Retry of {agentName(brain.agents[a.retryOf], workers)}</span>}
            {a.retriedBy && <span className="agent-row-note">Retried by {agentName(brain.agents[a.retriedBy], workers)}</span>}
            {a.branch && <span className="agent-row-branch">{a.branch}</span>}
            {replay.live && a.state === "failed" && !a.retriedBy && (
              <button type="button" className="brain-btn agent-row-retry" onClick={(e) => (e.stopPropagation(), retry(a._id))}>
                ↻ Retry
              </button>
            )}
          </span>
          {replay.live && a.kind === "worker" && active && a.state !== "stopping" && (
            <button
              type="button"
              className="agent-row-stop"
              title="Stop this worker"
              aria-label={`Stop ${agentName(a, workers)}`}
              onClick={(e) => (e.stopPropagation(), stop(a._id))}
            >
              ■
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="agent-roster">
      <div className="brain-pane-head">
        <h2 className="brain-pane-title">
          Agents <span className="bridge-count">{(core ? 1 : 0) + workers.length}</span>
        </h2>
        {BRAIN_IS_MOCK && <span className="brain-sim" title="Simulated agents until brain-api is connected (VITE_BRAIN_MODE=live)">Simulated</span>}
      </div>

      {spawning ? (
        <form className="agent-spawn" onSubmit={submit}>
          {goals.length > 0 && (
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Interval goal">
              <option value="">No interval goal</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  ◎ {g.text}
                </option>
              ))}
            </select>
          )}
          <textarea
            autoFocus
            rows={3}
            placeholder={goalId ? "Anything to add? (the goal is the task)" : "What should the worker do?"}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSpawning(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="agent-spawn-actions">
            <button type="button" className="brain-btn" onClick={() => setSpawning(false)}>Cancel</button>
            <button type="submit" className="brain-btn is-primary" disabled={!task.trim() && !goalId}>Start worker</button>
          </div>
        </form>
      ) : (
        <button type="button" className="brain-btn agent-spawn-open" onClick={() => setSpawning(true)} disabled={!core || !replay.live} title={replay.live ? undefined : "Go live to start a worker"}>
          ＋ Spawn worker
        </button>
      )}

      {!core ? (
        <p className="brain-empty">Waking the brain…</p>
      ) : (
        <>
          <ul className="agent-list">{row(core)}</ul>
          <h3 className="agent-list-label">Workers</h3>
          {workers.length ? <ul className="agent-list">{workers.map(row)}</ul> : <p className="brain-empty">No workers yet.</p>}
        </>
      )}
    </div>
  );
}
