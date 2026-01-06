import { Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";

import ThreePanelLayout from "./layout/ThreePanelLayout";
import ReEntry from "./screens/ReEntry";
import CreateProject from "./screens/CreateProject";

import BridgeDraftModal from "./components/BridgeDraftModal";
import BridgeHistoryModal from "./components/BridgeHistoryModal";

import {
  fetchProjects,
  fetchBridges,
  finalizeBridge,
} from "./api";

export default function App() {
  // ------------------------------
  // Global Continuum State
  // ------------------------------

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);

  // Runtime-only (current interval)
  const [activeBridge, setActiveBridge] = useState(null);

  // User-selected historical bridge (read-only)
  const [selectedBridge, setSelectedBridge] = useState(null);

  // Used to trigger bridge spine reloads
  const [bridgeRevision, setBridgeRevision] = useState(0);

  const [loading, setLoading] = useState(true);

  // ------------------------------
  // Initial Load
  // ------------------------------

  useEffect(() => {
    async function load() {
      const projectList = await fetchProjects();
      setProjects(projectList);

      if (projectList.length === 0) {
        setLoading(false);
        return;
      }

      // 🔒 Single-project invariant
      setActiveProject(projectList[0]);
      setLoading(false);
    }

    load();
  }, []);

  // ------------------------------
  // State Gates
  // ------------------------------

  if (loading) {
    return null;
  }

  if (projects.length === 0) {
    return (
      <CreateProject
        onCreated={(project) => {
          setProjects([project]);
          setActiveProject(project);
        }}
      />
    );
  }

  // ------------------------------
  // UI
  // ------------------------------

  return (
    <>
      {/* =====================================================
          Draft Bridge Modal (ACTIVE INTERVAL ONLY)
          ===================================================== */}
      {activeBridge && (
        <BridgeDraftModal
          bridge={activeBridge}
          onClose={async () => {
            // Closing modal = ending interval
            await finalizeBridge(activeBridge._id);

            setActiveBridge(null);
            setBridgeRevision((r) => r + 1); // refresh spine
          }}
        />
      )}

      {/* =====================================================
          History Bridge Modal (READ-ONLY)
          ===================================================== */}
      {selectedBridge && (
        <BridgeHistoryModal
          bridge={selectedBridge}
          onClose={() => setSelectedBridge(null)}
        />
      )}

      <ThreePanelLayout
        projects={projects}
        activeProject={activeProject}
        activeBridge={activeBridge}
        bridgeRevision={bridgeRevision}
        onSelectBridge={setSelectedBridge}
      >
        <Routes>
          <Route
            path="/"
            element={
              <ReEntry
                key={activeBridge ? activeBridge._id : "idle"}
                activeProject={activeProject}
                onIntervalStarted={(bridge) => {
                  setActiveBridge(bridge);
                  setBridgeRevision((r) => r + 1);
                }}
              />
            }
          />
        </Routes>
      </ThreePanelLayout>
    </>
  );
}
