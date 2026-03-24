import { useEffect, useState } from "react";
import { fetchBridges } from "../api";
import { assertBridge } from "../utils/assertBridge";
import { normalizeBridge } from "../utils/normalizeBridge";

import "./BridgeSpine.css";

export default function BridgeSpine({
  selectedProject,
  activeBridge,
  bridgeRevision,
  onSelectBridge,
}) {
  const [bridges, setBridges] = useState([]);

  /* =========================================================
     🔁 Load bridges for selected project
     - Normalize at API boundary (CRITICAL)
     - Assert canonical model only
     - Prevent malformed legacy data from entering UI
     ========================================================= */
  useEffect(() => {
    if (!selectedProject) return;

    let cancelled = false;

    async function loadBridges() {
      try {
        const data = await fetchBridges(selectedProject._id);
        console.log("RAW BRIDGES FROM API:", data);

        // 🧱 NORMALIZATION BOUNDARY (SINGLE SOURCE OF TRUTH)
        const normalized = data.map((bridge) => {
          console.log("Before normalize:", bridge);
          const result = normalizeBridge(bridge);
          console.log("After normalize:", result);
          return result;
        });

        // 🔒 HARD CONTRACT ASSERTION (DEV SAFETY)
        normalized.forEach((bridge) => {
          try {
            assertBridge(bridge);
          } catch (err) {
            console.error("Bridge assertion failed for:", bridge);
            throw err;
          }
        });

        if (!cancelled) {
          setBridges(normalized);
        }
      } catch (err) {
        console.error("Failed to load bridges", err);
      }
    }

    loadBridges();

    return () => {
      cancelled = true;
    };
  }, [selectedProject, bridgeRevision]);

  /* =========================================================
     📐 Stable ordering (oldest → newest)
     Defensive against legacy / missing index
     ========================================================= */
  const orderedBridges = [...bridges].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );

  return (
    <div className="bridge-spine">
      <div className="bridge-spine-title">Bridge Spine</div>

      {orderedBridges.map((bridge) => {
        console.log("Rendering bridge:", bridge);
        const isActive =
          activeBridge && bridge._id === activeBridge._id;

        return (
          <button
            key={bridge._id}
            className={`bridge-spine-item ${isActive ? "active" : ""
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
