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
      <div className="modal">
        <h2>{localBridge.name ?? "Bridge Draft"}</h2>

        <p className="subtle">
          Mark what happened in this interval.
        </p>

        <ul className="goals">
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

        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
