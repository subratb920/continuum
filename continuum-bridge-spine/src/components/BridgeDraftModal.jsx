import { useEffect, useState } from "react";
import { patchBridge } from "../api";

export default function BridgeDraftModal({ bridge, onClose }) {
  const [localBridge, setLocalBridge] = useState(bridge);

  // Sync when a different bridge opens
  useEffect(() => {
    setLocalBridge(bridge);
  }, [bridge]);

  // Auto-persist on any change
  useEffect(() => {
    if (!localBridge?._id) return;

    const timeout = setTimeout(() => {
      patchBridge(localBridge._id, {
        sessionGoals: localBridge.sessionGoals,
      });
    }, 300); // gentle debounce

    return () => clearTimeout(timeout);
  }, [localBridge]);

  function updateGoalStatus(id, status) {
    setLocalBridge((prev) => ({
      ...prev,
      sessionGoals: prev.sessionGoals.map((g) =>
        g.id === id ? { ...g, status } : g
      ),
    }));
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Bridge Draft</h2>

        <p className="subtle">
          Mark what happened in this interval.
        </p>

        <ul className="goals">
          {localBridge.sessionGoals.map((goal) => (
            <li key={goal.id}>
              <span>{goal.text}</span>

              <select
                value={goal.status}
                onChange={(e) =>
                  updateGoalStatus(goal.id, e.target.value)
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
