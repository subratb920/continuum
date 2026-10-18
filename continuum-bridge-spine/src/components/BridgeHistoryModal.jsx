import "./BridgeHistoryModal.css";
import "./AgentBridge.css"; // the Agent / Human mark and an agent bridge's tasks
import GoalAgents from "../screens/brain/GoalAgents";
import { formatClock, formatDateTime, formatDuration } from "../utils/time";
import { extractTicketKey } from "../utils/ticket";

export default function BridgeHistoryModal({ bridge, onClose }) {
  if (!bridge) return null;

  const goals = Array.isArray(bridge.sessionGoals)
    ? bridge.sessionGoals
    : bridge.sessionGoals
      ? [bridge.sessionGoals]
      : [];

  const agent = bridge.interval?.kind === "agent";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2 className="history-title">
            {agent ? <span className="bridge-kind is-agent">✦ Agent bridge</span> : <span className="bridge-kind is-human">Human bridge</span>}
            {bridge.name}
          </h2>
        </header>

        <section className="modal-body">
          <p className="modal-meta">
            {agent
              ? `${bridge.interval.mode} · worked by Continuum Brain${bridge.interval.workFrom === "device" ? " in your folder" : bridge.interval.workFrom === "github" ? " on GitHub" : ""} · ${bridge.interval.endedBy === "person" ? "stopped by you" : bridge.status === "draft" ? "in progress" : "ended by the brain"}`
              : `${bridge.interval.mode} · Interval duration ${formatDuration(bridge.interval.duration)}`}
          </p>

          {bridge.ticketUrl && (
            <p className="bridge-ticket">
              <strong>Ticket:</strong>{" "}
              <a
                href={bridge.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ticket-badge"
                title={bridge.ticketUrl}
              >
                {extractTicketKey(bridge.ticketUrl)}
              </a>
            </p>
          )}

          <h3>Session Goals</h3>

          {goals.length === 0 ? (
            <p className="empty-goals">
              No session goals were recorded for this interval.
            </p>
          ) : (
            <ul className="goal-list">
              {goals.map((g, index) => {
                const text =
                  typeof g.text === "string"
                    ? g.text
                    : g.text?.text ?? JSON.stringify(g.text);

                const status =
                  typeof g.status === "string"
                    ? g.status
                    : g.status?.status ?? "untouched";

                return (
                  <li key={g.id ?? `${index}-${text}`} className={agent ? "history-agent-goal" : undefined}>
                    <span className="goal-text">
                      {text}
                      {/* The agents that worked on it, as recorded when the interval was saved */}
                      {!g.tasks?.length && <GoalAgents agents={g.agents} />}
                      {/* An agent bridge: the brain's tasks for the goal and who did them, then its verdict */}
                      {g.tasks?.length > 0 && (
                        <ul className="agent-tasks">
                          {g.tasks.map((t) => {
                            const who = g.agents?.find((a) => a.agentId === t.agentId)?.name ?? (t.agentId ? `worker ${t.agentId.slice(-4)}` : null);
                            return (
                              <li key={t.id} className={`agent-task is-${t.state}`} title={t.note ?? undefined}>
                                <span className="agent-task-mark" aria-hidden="true">{{ done: "✓", working: "●", planned: "○", failed: "✕" }[t.state]}</span>
                                <span className="agent-task-text">{t.text}</span>
                                <span className="agent-task-worker is-none">{who ?? "not started"}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {g.verification?.note && <span className="agent-verdict-note history-verdict-note">The brain: {g.verification.note}</span>}
                    </span>
                    <span className={`goal-status ${status}`}>
                      {g.verification?.verdict === "completed" ? "✓ verified" : status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="bridge-times">
            <div className="bridge-time-row">
              <span className="bridge-time-label">Started</span>
              <span className="bridge-time-value">
                {formatDateTime(bridge.interval?.startedAt || bridge.createdAt)}
              </span>
            </div>
            <div className="bridge-time-row">
              <span className="bridge-time-label">Closed</span>
              <span className="bridge-time-value">
                {formatDateTime(
                  bridge.interval?.endedAt || bridge.updatedAt
                )}
              </span>
            </div>
            {/* Actual time spent: start → recorded end (Stop or Save) */}
            <div className="bridge-time-row">
              <span className="bridge-time-label">Worked</span>
              <span className="bridge-time-value">
                {bridge.interval?.startedAt && bridge.interval?.endedAt
                  ? formatClock(
                      new Date(bridge.interval.endedAt) -
                        new Date(bridge.interval.startedAt)
                    )
                  : "—"}
              </span>
            </div>
          </div>
        </section>



        <footer className="modal-footer">
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
