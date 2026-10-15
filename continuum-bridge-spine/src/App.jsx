import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { assertProject } from "./utils/assertions";

import { useAuth } from "./state/authStore";
import AuthGate from "./auth/AuthGate";
import SsoAuthorize from "./pages/SsoAuthorize";

import ThreePanelLayout from "./layout/ThreePanelLayout";
import PageShell from "./layout/PageShell";

import ReEntry from "./screens/ReEntry";
import CreateProject from "./screens/CreateProject";
import Dashboard, { DashboardNav } from "./components/Dashboard";
import { IMPORT_EVENT } from "./utils/importFromDevice";
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
  fetchBridges,
  fetchProjects,
} from "./api";

import { logger } from "./utils/logger";
import { normalizeBridge } from "./utils/normalizeBridge";
import {
  queueBridgeSave,
  getUnsavedBridgeChanges,
} from "./utils/bridgeAutosave";

// Last page on reopen (see App): only these pages are remembered
const LAST_PATH_KEY = "continuum_last_path";
const RESTORABLE_PATHS = ["/", "/console", "/dashboard", "/help"];

function readLastPath() {
  try {
    return localStorage.getItem(LAST_PATH_KEY);
  } catch {
    return null;
  }
}

function rememberLastPath(path) {
  try {
    localStorage.setItem(LAST_PATH_KEY, path);
  } catch {
    // storage unavailable — reopen simply shows the home page
  }
}

function forgetLastPath() {
  try {
    localStorage.removeItem(LAST_PATH_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  /* =========================================================
     🔒 AUTH + CORE STATE
     ========================================================= */

  const { status, logout } = useAuth();
  const { pathname, state: locationState } = useLocation();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [activeBridge, setActiveBridge] = useState(null);
  const [selectedBridge, setSelectedBridge] = useState(null);

  const [bridgeRevision, setBridgeRevision] = useState(0);

  const [showCreateProject, setShowCreateProject] = useState(false);
  // Import from device (header): the Create Project window opens with the folder's name
  const [createPrefill, setCreatePrefill] = useState(null);
  useEffect(() => {
    const onImport = (e) => {
      setCreatePrefill(e.detail);
      setShowCreateProject(true);
    };
    window.addEventListener(IMPORT_EVENT, onImport);
    return () => window.removeEventListener(IMPORT_EVENT, onImport);
  }, []);
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

  // Signed out: drop any open interval window so it can never show
  // for a different account (unsaved data stays in localStorage)
  useEffect(() => {
    if (status === "unauthenticated") {
      setActiveBridge(null);
      setSelectedBridge(null);
      forgetLastPath(); // next account on this browser starts fresh
    }
  }, [status]);

  /* =========================================================
     ↩ LAST PAGE ON REOPEN — when the browser is reopened (or the
     page reloaded) while still signed in, the base address shows
     the last page the user was on. A new sign-in never restores.
     ========================================================= */

  // Read before anything below can overwrite it
  const savedLastPath = useRef(readLastPath());
  const previousStatus = useRef(status);

  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = status;

    // checking → authenticated = token already present (reopen/reload)
    if (was === "checking" && status === "authenticated" && pathname === "/") {
      const target = savedLastPath.current;
      if (target && target !== "/" && RESTORABLE_PATHS.includes(target)) {
        navigate(target, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status === "authenticated" && RESTORABLE_PATHS.includes(pathname)) {
      rememberLastPath(pathname);
    }
  }, [pathname, status]);

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

        // 4️⃣ Resume an open interval (draft bridge) after a reload.
        //    Kept separate so a failure here never breaks the load.
        if (activeProject) {
          try {
            const bridges = await fetchBridges(activeProject._id);
            const draft = bridges
              .filter(b => b.status === "draft")
              .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];

            if (draft) {
              const resumed = normalizeBridge(draft);
              const unsaved = getUnsavedBridgeChanges(resumed._id);

              if (Array.isArray(unsaved?.sessionGoals)) {
                resumed.sessionGoals = unsaved.sessionGoals;
              }

              if (unsaved?.status === "finalized") {
                // The user already clicked Save/End but it never reached
                // the server (e.g. session ended): finish it now
                const result = await queueBridgeSave(resumed._id, {
                  status: "finalized",
                  ended: true,
                  sessionGoals: resumed.sessionGoals,
                });

                if (result.ok) {
                  logger.ui("Completed pending bridge save", resumed);
                  setBridgeRevision(r => r + 1);
                } else {
                  setActiveBridge(resumed);
                }
              } else {
                // Re-send changes the server never confirmed
                // (goal statuses, and a Stop that didn't reach the server)
                if (unsaved) {
                  if (unsaved.ended && !resumed.interval.endedAt) {
                    resumed.interval.endedAt = new Date().toISOString();
                  }
                  queueBridgeSave(resumed._id, unsaved);
                }

                logger.ui("Resumed open interval", resumed);
                setActiveBridge(resumed);
              }
            }
          } catch (resumeErr) {
            console.error("Could not resume open interval", resumeErr);
          }
        }
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
     ⏱ RUNNING INTERVAL — draft bridge window, shown on every
     signed-in page so it stays open for the whole interval
     ========================================================= */

  const draftModal = activeBridge && (
    <BridgeDraftModal
      bridge={activeBridge}
      onUpdate={handleUpdateActiveBridge}
      onSignIn={logout}
      onStop={(bridge) => {
        // Stop the timer: records interval.endedAt; stays a draft
        setActiveBridge(bridge);
        queueBridgeSave(bridge._id, {
          ended: true,
          sessionGoals: bridge.sessionGoals,
        });
      }}
      onEnd={async (bridge) => {
        // Goes through the autosave queue, so it is sent after any
        // pending goal saves (latest change wins). If it fails, the
        // data stays in localStorage and is completed on next load.
        // A stopped interval keeps its stop time as the end time.
        const result = await queueBridgeSave(bridge._id, {
          status: "finalized",
          // Omitted (not false) when stopped, so a Stop that hasn't
          // reached the server yet is still sent with this save
          ...(bridge.interval?.endedAt ? {} : { ended: true }),
          sessionGoals: bridge.sessionGoals,
        });

        if (!result.ok) {
          const err = new Error("Bridge could not be saved");
          err.code = result.unauthorized ? "UNAUTHORIZED" : "SAVE_FAILED";
          throw err;
        }

        setActiveBridge(null);
        setBridgeRevision(r => r + 1);
      }}
    />
  );

  /* =========================================================
     🔒 AUTH GATES
     ========================================================= */

  if (status === "checking") return null;
  if (pathname === "/auth/callback") {
    return <AuthCallback />;
  }
  if (status === "unauthenticated") return <AuthGate />;

  // Sign-in to Continuum Deploy (shown after Continuum's own sign-in if needed)
  if (pathname === "/sso/authorize") return <SsoAuthorize />;

  /* =========================================================
     📖 HELP PAGE (/help) — every signed-in user
     ========================================================= */

  if (pathname === "/help") {
    return (
      <PageShell scroll>
        <HelpPage />
        {draftModal}
      </PageShell>
    );
  }

  if (loading) return null;

  /* =========================================================
     📦 IMPORT FROM GITHUB (/import) — shown after a GitHub
     sign-in (AuthCallback sends GitHub sign-ins here)
     ========================================================= */

  if (pathname === "/import") {
    return (
      <PageShell scroll>
        <GithubImport
          onImported={async () => {
            // Refresh the project list so imported repos appear at once
            const list = await fetchProjects();
            setProjects(list);
          }}
          onDone={() => {
            // Opened from the header menu → back to that page;
            // after a GitHub sign-in (no "from") → home
            const from = locationState?.from;
            const returnTo = from && from !== "/import" ? from : "/";
            navigate(returnTo, { replace: true });
          }}
        />
        {draftModal}
      </PageShell>
    );
  }

  /* =========================================================
     🏠 HOME (/) — welcome page, always shown after sign-in.
     The console lives at /console.
     ========================================================= */

  if (pathname !== "/console" && pathname !== "/dashboard") {
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
        {draftModal}
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
    queueBridgeSave(updatedBridge._id, {
      sessionGoals: updatedBridge.sessionGoals,
    });
  }

  const isContextReady = !loading && projects.length > 0;
  const hasActiveProject = !!activeProject;

  /* =========================================================
     🖥️ UI
     ========================================================= */

  return (
    <PageShell selectedProject={selectedProject} panels>
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
        leftPane={pathname === "/dashboard" ? <DashboardNav onIntervalSetup={() => navigate("/console")} /> : null}
      >
        {pathname === "/dashboard" ? (
          // Dashboard (profile menu): the overview, in the console's middle pane
          <Dashboard
            projects={projects}
            activeProject={activeProject}
            activeBridge={activeBridge}
            bridgeRevision={bridgeRevision}
            onSelectProject={setSelectedProject}
            onOpenInterval={() => navigate("/console")}
          />
        ) : projects.length === 0 ? (
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
              key={createPrefill ? `import:${createPrefill.name}` : "new"}
              initialName={createPrefill?.name ?? ""}
              importedFrom={createPrefill?.from ?? null}
              contents={createPrefill?.contents ?? null}
              onCreated={(project) => {
                logger.ui("modal onCreated received project", project);
                setProjects(prev => [...prev, project]);
                setSelectedProject(project);
                setShowCreateProject(false);
                setCreatePrefill(null);
              }}
              onClose={() => {
                setShowCreateProject(false);
                setCreatePrefill(null);
              }}
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
      {draftModal}

      {selectedBridge && (
        <BridgeHistoryModal
          bridge={selectedBridge}
          onClose={() => setSelectedBridge(null)}
        />
      )}
    </PageShell>
  );
}
