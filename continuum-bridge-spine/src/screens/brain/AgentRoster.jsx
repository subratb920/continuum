import { useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES, STATE_LABEL } from "../../brain/brainTypes";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { agentName, elapsed, runningModel, useNow } from "./agentDisplay";
import SkillsDialog from "./SkillsDialog";
import "./brain.css";

/** When an agent started, as a number for sorting (0 if unknown). */
const startedMs = (a) => (a.startedAt ? new Date(a.startedAt).getTime() : 0) || 0;
/** Workers newest first (most recently started at the top), without mutating the source. */
const latestFirst = (list) => [...list].sort((a, b) => startedMs(b) - startedMs(a));

/**
 * Agents pane (left): the core (your brain), then its workers, newest first —
 * each with its state, task, the interval goal it works on, branch and running
 * time. The brain starts, retries and stops workers itself as it does the work
 * you give it in Chat; you can stop a worker here. Model: the one model your
 * brain and every worker run on. While replaying, the actions wait.
 */
export default function AgentRoster() {
  const brain = useBrain();
  const now = useNow();
  const [skillsOpen, setSkillsOpen] = useState(false);

  if (!brain) return null;
  const { core, workers, pending, selectedId, select, stop, replay } = brain;
  const asking = new Set(pending.map((e) => e.agentId));
  const clockNow = replay.live ? now : replay.at;

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
            {runningModel(a) && (
              <span className="agent-row-model" title={a.runtimeModel ? `Runs on ${a.runtimeModel}` : `Will run on ${a.model}`}>
                {runningModel(a)}
              </span>
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

      {/* Skills: the know-how your brain and workers load when the work fits (real brain only). */}
      {brain.skills && (
        <button type="button" className="brain-btn agent-skills-open" onClick={() => setSkillsOpen(true)} title="Know-how your agents load when the work fits">
          ✦ Manage skills
        </button>
      )}

      {core ? (
        <ul className="agent-list">{row(core)}</ul>
      ) : (
        // The brain starts with your first message in Chat; it starts workers itself from there.
        <p className="brain-empty">{BRAIN_IS_MOCK ? "Waking the brain…" : "Your brain starts with your first message in Chat, and starts workers itself from there."}</p>
      )}
      {(core || !BRAIN_IS_MOCK) && (
        <>
          <h3 className="agent-list-label">Workers</h3>
          {workers.length ? <ul className="agent-list">{latestFirst(workers).map(row)}</ul> : <p className="brain-empty">No workers yet — the brain starts them as it works on what you ask in Chat.</p>}
        </>
      )}

      {skillsOpen && <SkillsDialog brain={brain} onClose={() => setSkillsOpen(false)} />}
    </div>
  );
}
