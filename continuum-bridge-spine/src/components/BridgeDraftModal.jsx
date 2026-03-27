import { useEffect, useState } from "react";

export default function BridgeDraftModal({
  bridge,
  onUpdate,
  onClose,
}) {
  // ✅ Local, authoritative copy
  const [localBridge, setLocalBridge] = useState(bridge);

  // ✅ Resync if a different bridge opens
  useEffect(() => {
    setLocalBridge(bridge);
  }, [bridge]);

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

  return (
    <div className="modal-backdrop">
      <div className="modal-window">

        <header className="modal-header">
          <h2>{localBridge.name ?? "Bridge Draft"}</h2>
        </header>

        <section className="modal-body">

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

        </section>

        <footer className="modal-footer">
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </footer>

      </div>
    </div>
  );
}
