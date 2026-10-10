import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { assertProject } from "./utils/assertions";

import { useAuth } from "./state/authStore";
import AuthGate from "./auth/AuthGate";

import ThreePanelLayout from "./layout/ThreePanelLayout";
import PageShell from "./layout/PageShell";

import ReEntry from "./screens/ReEntry";
import CreateProject from "./screens/CreateProject";
import Welcome from "./screens/Welcome";
import HelpPage from "./pages/HelpPage";
import EmptyConsole from "./components/EmptyConsole";

import BridgeDraftModal from "./components/BridgeDraftModal";
import BridgeHistoryModal from "./components/BridgeHistoryModal";
import ActivateProjectModal from "./components/ActivateProjectModal";
import EditProjectModal from "./components/EditProjectModal";
import DeleteProjectModal from "./components/DeleteProjectModal";
import AuthCallback from "./pages/AuthCallback";
import GithubImport from "./screens/GithubImport";

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

  const { status, logout, authProvider } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [activeBridge, setActiveBridge] = useState(null);
  const [selectedBridge, setSelectedBridge] = useState(null);

  const [bridgeRevision, setBridgeRevision] = useState(0);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showActivateProject, setShowActivateProject] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);

  const [loading, setLoading] = useState(true);

  /* =========================================================
     🧱 INVARIANT ENFORCEMENT
     ========================================================= */

  useEffect(() => {
    projects.forEach(assertProject);
  }, [projects]);

  /* =========================================================
     🧠 APPLICATION LIFECYCLE LOGGING
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

        // 1️⃣ Fetch canonical project list
        const projectList = await fetchProjects();
        logger.ui("fetchProjects returned", projectList);
        setProjects(projectList);

        // 2️⃣ Fetch active project reference
        const { activeProject } = await fetchActiveProject();
        logger.ui("fetchActiveProject returned", { activeProject });

        // 3️⃣ Resolve active project object
        const active =
          projectList.find(p => p._id === activeProject?._id) || null;

        setActiveProject(activeProject);
        setSelectedProject(activeProject);
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

  // Keyed on the id so a rename of the active project doesn't
  // move the user's current selection
  useEffect(() => {
    if (activeProject) {
      setSelectedProject(activeProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?._id]);

  /* =========================================================
     🔍 STATE CHANGE LOGGING
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
  if (pathname === "/auth/callback") {
    return <AuthCallback />;
  }
  if (status === "unauthenticated") return <AuthGate />;

  /* =========================================================
     📖 HELP PAGE (/help) — every signed-in user
     ========================================================= */

  if (pathname === "/help") {
    return (
      <PageShell scroll>
        <HelpPage />
      </PageShell>
    );
  }

  if (loading) return null;

  /* =========================================================
     📭 EMPTY STATE — NO PROJECTS
     ========================================================= */

  if (authProvider === "github") {
    return (
      <PageShell scroll>
        <GithubImport />
      </PageShell>
    );
  }

  /* =========================================================
     🏠 HOME (/) — welcome page, always shown after sign-in.
     The console lives at /console.
     ========================================================= */

  if (pathname !== "/console") {
    return (
      <PageShell scroll>
        <Welcome
          projectCount={projects.length}
          activeProject={activeProject}
          onCreated={(project) => {
            logger.ui("onCreated received project", project);
            setProjects(prev => [...prev, project]);
            setSelectedProject(project);
            navigate("/console");
          }}
          onContinue={() => navigate("/console")}
        />
      </PageShell>
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

  function handleProjectRenamed(updated) {
    const rename = (p) =>
      p?._id === updated._id ? { ...p, name: updated.name } : p;

    setProjects(prev => prev.map(rename));
    setActiveProject(prev => rename(prev));
    setSelectedProject(prev => rename(prev));
    setShowEditProject(false);
  }

  function handleProjectDeleted(project) {
    setProjects(prev => prev.filter(p => p._id !== project._id));

    if (selectedProject?._id === project._id) {
      setSelectedProject(null);
      setSelectedBridge(null);
    }

    // Backend also clears the active-project pointer
    if (activeProject?._id === project._id) {
      setActiveProject(null);
      setActiveBridge(null);
    }

    setShowDeleteProject(false);
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
    <PageShell>
      <ThreePanelLayout
        projects={projects}
        activeProject={activeProject}
        selectedProject={selectedProject}
        activeBridge={activeBridge}
        bridgeRevision={bridgeRevision}
        onSelectProject={setSelectedProject}
        onSelectBridge={setSelectedBridge}
        onCreateProject={() => setShowCreateProject(true)}
        onActivateProject={() => setShowActivateProject(true)}
        onEditProject={() => setShowEditProject(true)}
        onDeleteProject={() => setShowDeleteProject(true)}
      >
        {projects.length === 0 ? (
          <EmptyConsole onCreateProject={() => setShowCreateProject(true)} />
        ) : isContextReady && hasActiveProject ? (
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

      {/* ============================
          Create Project Modal
         ============================ */}
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

      {/* ============================
          Activate / Deactivate Modal
         ============================ */}
      {showActivateProject && (
        <ActivateProjectModal
          projects={projects}
          activeProject={activeProject}
          initialProject={selectedProject}
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

      {/* ============================
          Edit Project Modal
         ============================ */}
      {showEditProject && (
        <EditProjectModal
          projects={projects}
          onRenamed={handleProjectRenamed}
          onClose={() => setShowEditProject(false)}
        />
      )}

      {/* ============================
          Delete Project Modal
         ============================ */}
      {showDeleteProject && (
        <DeleteProjectModal
          projects={projects}
          activeProject={activeProject}
          onDeleted={handleProjectDeleted}
          onClose={() => setShowDeleteProject(false)}
        />
      )}

      {/* ============================
          Bridge Modals
         ============================ */}
      {activeBridge && (
        <BridgeDraftModal
          bridge={activeBridge}
          onUpdate={handleUpdateActiveBridge}
          onClose={async () => {
            await finalizeBridge(
              activeBridge._id,
              activeBridge.sessionGoals
            );

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
    </PageShell>
  );
}
