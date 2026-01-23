import { useEffect, useState } from "react";
import { assertProject } from "./utils/assertions";


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

import { logger } from "./utils/logger";

export default function App() {
  /* =========================================================
     🔒 AUTH + CORE STATE
     ========================================================= */

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

  useEffect(() => {
  projects.forEach(assertProject);
}, [projects]);

  /* =========================================================
     🧠 APPLICATION LIFECYCLE LOGGING
     Purpose:
     - Detect refresh vs first load
     - Observe full React remounts
     ========================================================= */

  useEffect(() => {
    logger.lifecycle("App mounted");

    const nav = performance.getEntriesByType("navigation")[0];
    if (nav?.type === "reload") {
      logger.lifecycle("Page refresh detected");
    } else {
      logger.lifecycle("Initial navigation detected");
    }

    return () => {
      logger.lifecycle("App unmounted");
    };
  }, []);

  /* =========================================================
     🔁 INITIAL DATA LOAD (AUTHENTICATED CONTEXT)
     ========================================================= */

  useEffect(() => {
    if (status !== "authenticated") return;

    async function load() {
      try {
        logger.ui("Initial load started");

        // 1️⃣ Fetch canonical project list from backend
        const projectList = await fetchProjects();
        logger.ui("fetchProjects returned", projectList);
        setProjects(projectList);

        // 2️⃣ Fetch active project reference
        const { activeProjectId } = await fetchActiveProject();
        logger.ui("fetchActiveProject returned", { activeProjectId });

        // 3️⃣ Resolve active project object from list
        const active =
          projectList.find(p => p._id === activeProjectId) || null;

        setActiveProject(active);
        setSelectedProject(active); // single source of truth
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

  /* =========================================================
     ✅ INVARIANT: selectedProject mirrors activeProject
     ========================================================= */

  useEffect(() => {
    if (activeProject) {
      setSelectedProject(activeProject);
    }
  }, [activeProject]);

  /* =========================================================
     🔍 STATE CHANGE LOGGING (DEBUG VISIBILITY)
     ========================================================= */

  useEffect(() => {
    logger.state("projects state updated", projects);
  }, [projects]);

  useEffect(() => {
    logger.state("activeProject updated", activeProject);
  }, [activeProject]);

  useEffect(() => {
    logger.state("selectedProject updated", selectedProject);
  }, [selectedProject]);

  /* =========================================================
     🔒 AUTH GATES
     ========================================================= */

  if (status === "checking") return null;
  if (status === "unauthenticated") return <AuthGate />;
  if (loading) return null;

  /* =========================================================
     📭 EMPTY STATE — NO PROJECTS EXIST
     ========================================================= */

  if (projects.length === 0) {
    return (
      <CreateProject
        onCreated={(project) => {
          logger.ui("onCreated received project", project);
          setProjects([project]);
          setSelectedProject(project);
        }}
      />
    );
  }

  /* =========================================================
     🎮 EXECUTION HANDLERS
     ========================================================= */

  function handleActivate(project) {
    setActiveProject(project);
  }

  function handleDeactivate() {
    setActiveProject(null);
    setSelectedProject(null);
  }

  function handleUpdateActiveBridge(updatedBridge) {
    setActiveBridge(updatedBridge);
    patchBridge(updatedBridge._id, {
      sessionGoals: updatedBridge.sessionGoals,
    });
  }

  const isContextReady = !loading && projects.length > 0;
  const hasActiveProject = !!activeProject;

  /* =========================================================
     🖥️ UI
     ========================================================= */

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

      {/* Project Actions */}
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
                logger.ui("modal onCreated received project", project);
                setProjects(prev => [...prev, project]);
                setSelectedProject(project);
                setShowCreateProject(false);
              }}
              onClose={() => setShowCreateProject(false)}
            />
          </div>
        </div>
      )}

      {/* Activate / Deactivate */}
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
