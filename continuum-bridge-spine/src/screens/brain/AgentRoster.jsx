import { useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES, STATE_LABEL } from "../../brain/brainTypes";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { agentName, elapsed, useNow } from "./agentDisplay";
import "./brain.css";

/**
 * Agents pane (left): the core, then its workers, each with its state, task,
 * branch and running time. Spawn starts a worker through the core.
 */
export default function AgentRoster() {
  const brain = useBrain();
  const now = useNow();
  const [spawning, setSpawning] = useState(false);
  const [task, setTask] = useState("");

  if (!brain) return null;
  const { core, workers, pending, selectedId, select, stop } = brain;
  const asking = new Set(pending.map((e) => e.agentId));

  function submit(e) {
    e.preventDefault();
    if (!task.trim()) return;
    brain.spawn(task.trim());
    setTask("");
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
              <span className="agent-row-time">{elapsed(a.startedAt, a.finishedAt ?? now)}</span>
            </span>
            <span className="agent-row-task" title={a.task}>{a.task}</span>
            {a.branch && <span className="agent-row-branch">{a.branch}</span>}
          </span>
          {a.kind === "worker" && active && a.state !== "stopping" && (
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
          <textarea
            autoFocus
            rows={3}
            placeholder="What should the worker do?"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSpawning(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="agent-spawn-actions">
            <button type="button" className="brain-btn" onClick={() => setSpawning(false)}>Cancel</button>
            <button type="submit" className="brain-btn is-primary" disabled={!task.trim()}>Start worker</button>
          </div>
        </form>
      ) : (
        <button type="button" className="brain-btn agent-spawn-open" onClick={() => setSpawning(true)} disabled={BRAIN_IS_MOCK && !core}>
          ＋ Spawn worker
        </button>
      )}

      {core ? (
        <ul className="agent-list">{row(core)}</ul>
      ) : (
        // The real brain starts with your first message (Chat, or a worker to start)
        <p className="brain-empty">{BRAIN_IS_MOCK ? "Waking the brain…" : "Your brain starts with your first message."}</p>
      )}
      {(core || !BRAIN_IS_MOCK) && (
        <>
          <h3 className="agent-list-label">Workers</h3>
          {workers.length ? <ul className="agent-list">{workers.map(row)}</ul> : <p className="brain-empty">No workers yet.</p>}
        </>
      )}
    </div>
  );
}
