import "./BridgeHistoryModal.css";

export default function BridgeHistoryModal({ bridge, onClose }) {
  if (!bridge) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()} // prevent close on click inside
      >
        <header className="modal-header">
          <h2>{bridge.name}</h2>
        </header>

        <section className="modal-body">
          <p className="modal-meta">
            {bridge.interval.mode} · {bridge.interval.duration} min
          </p>

          <h3>Session Goals</h3>
          <ul className="goal-list">
            {bridge.sessionGoals.map((g) => (
              <li key={g.id}>
                <span>{g.text}</span>
                <span className={`goal-status ${g.status}`}>
                  {g.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="modal-footer">
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
