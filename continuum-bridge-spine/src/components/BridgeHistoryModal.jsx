import "./BridgeHistoryModal.css";

export default function BridgeHistoryModal({ bridge, onClose }) {
  if (!bridge) return null;

  const goals = bridge.sessionGoals ?? [];

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

          <h3>Session Goals</h3>

          {goals.length === 0 ? (
            <p className="empty-goals">
              No session goals were recorded for this interval.
            </p>
          ) : (
            <ul className="goal-list">
              {goals.map((g, index) => (
                <li key={g.id ?? `${index}-${g.text}`}>
                  <span>{g.text}</span>
                  <span className={`goal-status ${g.status}`}>
                    {g.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="modal-footer">
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
