import { STATE_LABEL } from "../../brain/brainTypes";
import "./brain.css";

/**
 * The workers on an interval goal, as small chips: live in the running
 * interval's window, recorded in the Bridge once the interval is saved.
 * agents: [{ agentId, name, state, task, branch, error }] (agentWork.js's shape)
 * onOpen(agentId): opens that worker on the Agents screen (live only)
 */
export default function GoalAgents({ agents, onOpen }) {
  if (!agents?.length) return null;
  return (
    <ul className="goal-agents" aria-label="Agents on this goal">
      {agents.map((a) => {
        const label = (
          <>
            <span className="agent-dot" aria-hidden="true" /> {a.name} · {STATE_LABEL[a.state]?.toLowerCase() ?? a.state}
          </>
        );
        const title = [a.task, a.branch, a.error].filter(Boolean).join(" · ");
        return (
          <li key={a.agentId} className={`state-${a.state}`}>
            {onOpen ? (
              <button type="button" className="goal-agent" onClick={() => onOpen(a.agentId)} title={title}>
                {label}
              </button>
            ) : (
              <span className="goal-agent" title={title}>
                {label}
                {a.branch && <span className="goal-agent-branch">{a.branch}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
