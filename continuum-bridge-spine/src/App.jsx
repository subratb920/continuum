import { Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";

import ThreePanelLayout from "./layout/ThreePanelLayout";
import ReEntry from "./screens/ReEntry";
import CreateProject from "./screens/CreateProject";

import BridgeDraftModal from "./components/BridgeDraftModal";
import BridgeHistoryModal from "./components/BridgeHistoryModal";

import {
  fetchActiveProject,
  fetchProjects,
  finalizeBridge,
} from "./api";

export default function App() {
  // ------------------------------
  // Global Continuum State
  // ------------------------------

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [activeBridge, setActiveBridge] = useState(null);
  const [selectedBridge, setSelectedBridge] = useState(null);

  const [bridgeRevision, setBridgeRevision] = useState(0);
  const [showCreateProject, setShowCreateProject] = useState(false);

  const [loading, setLoading] = useState(true);

  // ------------------------------
  // Initial Load
  // ------------------------------

  useEffect(() => {
    async function load() {
      const projectList = await fetchProjects();
      setProjects(projectList);

      const { activeProject } = await fetchActiveProject();
      console.log("ACTIVE PROJECT ID:", activeProject?._id);
      console.log("PROJECT LIST:", projectList);

      const active =
        projectList.find(p => p._id === activeProject?._id) || null;
      console.log("RESOLVED ACTIVE PROJECT:", active);
      setActiveProject(active);

      // Default selection = active project OR first project
      setSelectedProject(active || projectList[0] || null);

      console.log("1. SelectedProject set to:", active || projectList[0] || null);
      console.log("2. SelectedProject set to:", selectedProject);
      setLoading(false);
    }

    load();
  }, []);

  useEffect(() => {
  if (activeProject && !selectedProject) {
    setSelectedProject(activeProject);
  }
}, [activeProject]);





  // ------------------------------
  // State Gates
  // ------------------------------

  if (loading) return null;

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
          Create Project Modal (STRUCTURAL)
          ===================================================== */}
      {showCreateProject && (
        <div className="modal-backdrop">
          <div className="modal-window">
            <CreateProject
              onCreated={(project) => {
                setProjects((prev) => [...prev, project]);
                setShowCreateProject(false);
              }}
              onClose={() => setShowCreateProject(false)}
            />

          </div>
        </div>
      )}

      {/* =====================================================
          Draft Bridge Modal (ACTIVE INTERVAL)
          ===================================================== */}
      {activeBridge && (
        <BridgeDraftModal
          bridge={activeBridge}
          onClose={async () => {
            await finalizeBridge(activeBridge._id);
            setActiveBridge(null);
            setBridgeRevision((r) => r + 1);
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
        selectedProject={selectedProject}
        activeBridge={activeBridge}
        bridgeRevision={bridgeRevision}
        onSelectProject={setSelectedProject}
        onSelectBridge={setSelectedBridge}
        onCreateProject={() => setShowCreateProject(true)}
      >
        <Routes>
          <Route
            path="/"
            element={
              <ReEntry
                key={activeBridge ? activeBridge._id : "idle"}
                activeProject={activeProject}
                selectedProject={selectedProject}
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
