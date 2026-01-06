import { useEffect, useState } from "react";
import { fetchBridges } from "../api";
import "./BridgeSpine.css";

export default function BridgeSpine({
  activeProject,
  activeBridge,
  bridgeRevision,
  onSelectBridge,
}) {
  const [bridges, setBridges] = useState([]);

  useEffect(() => {
    if (!activeProject) return;
    fetchBridges(activeProject._id).then(setBridges);
  }, [activeProject, bridgeRevision]);

  // Oldest → newest
  const orderedBridges = [...bridges].sort(
    (a, b) => a.index - b.index
  );

  return (
    <div className="bridge-spine">
      <div className="bridge-spine-title">Bridge Spine</div>

      {orderedBridges.map((bridge) => {
        const isActive =
          activeBridge && bridge._id === activeBridge._id;

        return (
          <button
            key={bridge._id}
            className={`bridge-spine-item ${
              isActive ? "active" : ""
            }`}
            onClick={() => onSelectBridge(bridge)}
          >
            <div className="bridge-name">
              {bridge.name}
            </div>

            {bridge.status === "draft" && (
              <div className="bridge-status">Draft</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
