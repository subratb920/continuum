import { useEffect, useState } from "react";

import { useAuth } from "./state/authStore";
import AuthGate from "./auth/AuthGate";

import ThreePanelLayout from "./layout/ThreePanelLayout";
import ShellHeader from "./layout/ShellHeader";

import ReEntry from "./screens/ReEntry";
import CreateProject from "./screens/CreateProject";

import BridgeDraftModal from "./components/BridgeDraftModal";
import BridgeHistoryModal from "./components/BridgeHistoryModal";

import ProjectActionMenu from "./components/ProjectActionMenu";
import ActivateProjectModal from "./components/ActivateProjectModal";

import {
  fetchActiveProject,
  fetchProjects,
  finalizeBridge,
  patchBridge,
} from "./api";

export default function App() {
  // ---------------------------------
  // 🔒 ALL HOOKS MUST COME FIRST
  // ---------------------------------
  const { status, logout } = useAuth();

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [activeBridge, setActiveBridge] = useState(null);
  const [selectedBridge, setSelectedBridge] = useState(null);

  const [bridgeRevision, setBridgeRevision] = useState(0);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showProjectActionMenu, setShowProjectActionMenu] = useState(false);
  const [showActivateProject, setShowActivateProject] = useState(false);

  const [loading, setLoading] = useState(true);

  // ---------------------------------
  // 🔁 Initial Load (AUTH + CONTEXT)
  // ---------------------------------
  useEffect(() => {
    if (status !== "authenticated") return;

    async function load() {
      try {
        const projectList = await fetchProjects();
        setProjects(projectList);

        const { activeProjectId } = await fetchActiveProject();

        const active =
          projectList.find(p => p._id === activeProjectId) || null;

        setActiveProject(active);
        setSelectedProject(active); // ✅ single source of truth
      } catch (err) {
        if (err.message === "UNAUTHORIZED") {
          logout();
          return;
        }
        console.error("Failed to load execution state", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [status, logout]);

  // ---------------------------------
  // ✅ HARD INVARIANT ENFORCEMENT
  // ---------------------------------
  useEffect(() => {
    if (activeProject) {
      setSelectedProject(activeProject);
    }
  }, [activeProject]);

  const isContextReady = !loading && projects.length > 0;
  const hasActiveProject = !!activeProject;

  // ---------------------------------
  // 🔒 AUTH GATE
  // ---------------------------------
  if (status === "checking") return null;
  if (status === "unauthenticated") return <AuthGate />;
  if (loading) return null;

  // ---------------------------------
  // Empty State
  // ---------------------------------
  if (projects.length === 0) {
    return (
      <CreateProject
        onCreated={(project) => {
          setProjects([project]);
          setActiveProject(project);
          setSelectedProject(project);
        }}
      />
    );
  }

  // ---------------------------------
  // Execution Handlers
  // ---------------------------------
  function handleActivate(project) {
    setActiveProject(project); // selectedProject syncs automatically
  }

  function handleUpdateActiveBridge(updatedBridge) {
    setActiveBridge(updatedBridge);

    patchBridge(updatedBridge._id, {
      sessionGoals: updatedBridge.sessionGoals,
    });
  }

  function handleDeactivate() {
    setActiveProject(null);
    setSelectedProject(null); // ✅ avoid stale selection
  }

  // ---------------------------------
  // UI
  // ---------------------------------
  return (
    <div className="shell">
      <ShellHeader />

      <ThreePanelLayout
        projects={projects}
        activeProject={activeProject}
        selectedProject={selectedProject}
        activeBridge={activeBridge}
        bridgeRevision={bridgeRevision}
        onSelectProject={setSelectedProject}
        onSelectBridge={setSelectedBridge}
        onCreateProject={() => setShowProjectActionMenu(true)}
      >
        {isContextReady && hasActiveProject ? (
          <ReEntry
            key={activeBridge ? activeBridge._id : "idle"}
            activeProject={activeProject}
            selectedProject={selectedProject}
            onIntervalStarted={(bridge) => {
              setActiveBridge(bridge);
              setBridgeRevision(r => r + 1);
            }}
          />
        ) : (
          <div className="empty-state">
            <p>Activate a project to start an interval.</p>
          </div>
        )}
      </ThreePanelLayout>

      {/* Project Action Menu */}
      {showProjectActionMenu && (
        <ProjectActionMenu
          onCreate={() => {
            setShowProjectActionMenu(false);
            setShowCreateProject(true);
          }}
          onActivate={() => {
            setShowProjectActionMenu(false);
            setShowActivateProject(true);
          }}
          onClose={() => setShowProjectActionMenu(false)}
        />
      )}

      {/* Create Project Modal */}
      {showCreateProject && (
        <div className="modal-backdrop">
          <div className="modal-window">
            <CreateProject
              onCreated={(project) => {
                setProjects(prev => [...prev, project]);
                setSelectedProject(project);
                setShowCreateProject(false);
              }}
              onClose={() => setShowCreateProject(false)}
            />
          </div>
        </div>
      )}

      {/* Activate / Deactivate Modal */}
      {showActivateProject && (
        <ActivateProjectModal
          projects={projects}
          activeProject={activeProject}
          onActivated={(project) => {
            handleActivate(project);
            setShowActivateProject(false);
          }}
          onDeactivated={() => {
            handleDeactivate();
            setShowActivateProject(false);
          }}
          onClose={() => setShowActivateProject(false)}
        />
      )}

      {/* Bridge Modals */}
      {activeBridge && (
        <BridgeDraftModal
          bridge={activeBridge}
          onUpdate={handleUpdateActiveBridge}
          onClose={async () => {
            await finalizeBridge(activeBridge._id);
            setActiveBridge(null);
            setBridgeRevision(r => r + 1);
          }}
        />
      )}

      {selectedBridge && (
        <BridgeHistoryModal
          bridge={selectedBridge}
          onClose={() => setSelectedBridge(null)}
        />
      )}
    </div>
  );
}
