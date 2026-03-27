import "./BridgeHistoryModal.css";
import { formatDateTime } from "../utils/time";
import { extractTicketKey } from "../utils/ticket";

export default function BridgeHistoryModal({ bridge, onClose }) {
  if (!bridge) return null;

  const goals = Array.isArray(bridge.sessionGoals)
    ? bridge.sessionGoals
    : bridge.sessionGoals
      ? [bridge.sessionGoals]
      : [];

  console.log("Goals data:", bridge.sessionGoals);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{bridge.name}</h2>
        </header>

        <section className="modal-body">
          <p className="modal-meta">
            {bridge.interval.mode} · {bridge.interval.duration} min
          </p>

          {bridge.ticketUrl && (
            <p className="bridge-ticket">
              <strong>Ticket:</strong>{" "}
              <a
                href={bridge.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ticket-badge"
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
                  <li key={g.id ?? `${index}-${text}`}>
                    <span>{text}</span>
                    <span className={`goal-status ${status}`}>
                      {status}
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
          </div>
        </section>



        <footer className="modal-footer">
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
