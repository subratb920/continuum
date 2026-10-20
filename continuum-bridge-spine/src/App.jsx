import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { assertProject } from "./utils/assertions";

import { useAuth } from "./state/authStore";
import { deferred } from "./utils/deferred";
import NoAccess from "./components/NoAccess";
import { useAppOpened } from "./state/useAppOpened";
const AuthGate = deferred(() => import("./auth/AuthGate"));
const SsoAuthorize = deferred(() => import("./pages/SsoAuthorize"));

import ThreePanelLayout from "./layout/ThreePanelLayout";
import PageShell from "./layout/PageShell";

const ReEntry = deferred(() => import("./screens/ReEntry"));
const CreateProject = deferred(() => import("./screens/CreateProject"));
const Dashboard = deferred(() => import("./components/Dashboard"));
import { screenForPath } from "./screens/registry";
import { setRunningInterval } from "./brain/runningInterval";
import { IMPORT_EVENT } from "./utils/importFromDevice";
const Welcome = deferred(() => import("./screens/Welcome"));
const Landing = deferred(() => import("./screens/Landing"));
const HelpPage = deferred(() => import("./pages/HelpPage"));
const LegalPage = deferred(() => import("./legal/LegalPage"));
const EmptyConsole = deferred(() => import("./components/EmptyConsole"));
const PhoneCard = deferred(() => import("./components/PhoneCard"));

const AgentBridge = deferred(() => import("./components/AgentBridge"));
const BridgeDraftModal = deferred(() => import("./components/BridgeDraftModal"));
const BridgeHistoryModal = deferred(() => import("./components/BridgeHistoryModal"));
const ActivateProjectModal = deferred(() => import("./components/ActivateProjectModal"));
const EditProjectModal = deferred(() => import("./components/EditProjectModal"));
const DeleteProjectModal = deferred(() => import("./components/DeleteProjectModal"));
const AuthCallback = deferred(() => import("./pages/AuthCallback"));
const GithubImport = deferred(() => import("./screens/GithubImport"));
// The wizard (and its technology logos) loads only when /new is opened
const NewProject = lazy(() => import("./screens/NewProject/NewProject"));
const Workspaces = lazy(() => import("./screens/Workspaces"));

import {
  fetchAccountPreferences,
  fetchActiveProject,
  fetchBridges,
  fetchProjects,
  saveAccountTheme,
} from "./api";
import { getPreferences, setPreference, themeChosenHere } from "./utils/preferences";

import { logger } from "./utils/logger";
import { normalizeBridge } from "./utils/normalizeBridge";
import {
  queueBridgeSave,
  getUnsavedBridgeChanges,
} from "./utils/bridgeAutosave";

// Continuum opens on Workflows; the last page used to be remembered here (cleared on sign-out)
const LAST_PATH_KEY = "continuum_last_path";

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

  const { status, logout, can, access } = useAuth();
  // Projects and intervals can be read with Interval Setup or the Dashboard switched on
  const projectsOpen = can("interval") || can("dashboard");
  const { pathname, state: locationState } = useLocation();
  useAppOpened(pathname); // which apps people open (the admin's view)
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
  // The wizard's "Empty project" card: the console opens with the name-only window
  useEffect(() => {
    if (pathname === "/console" && locationState?.createEmpty) {
      setShowCreateProject(true);
      navigate("/console", { replace: true, state: null });
    }
  }, [pathname, locationState, navigate]);
  const [showActivateProject, setShowActivateProject] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  // The project whose settings gear (in the projects pane) opened one of those windows
  const [projectForAction, setProjectForAction] = useState(null);

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

  const previousStatus = useRef(status);

  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = status;

    // checking → authenticated = token already present (reopen/reload): Continuum opens on Workflows
    // (a link straight to another screen still goes there)
    if (was === "checking" && status === "authenticated" && pathname === "/") {
      navigate("/workflows", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // The theme lives with the account (Continuum Deploy follows it): take it on sign-in.
  // A theme picked on this device before it was kept with the account is uploaded once.
  useEffect(() => {
    if (status !== "authenticated") return;
    fetchAccountPreferences()
      .then(({ theme, chosen }) => {
        if (!chosen && themeChosenHere()) saveAccountTheme(getPreferences().theme).catch(() => {});
        else if (theme && theme !== getPreferences().theme) setPreference("theme", theme);
      })
      .catch(() => {});
  }, [status]);

  // Continuum opens on Workflows; a role without Agents (Workflows needs it) lands on the
  // home page instead (once your access is known), not on "No feature access"
  const landing = useRef(true);
  useEffect(() => {
    if (status !== "authenticated" || !access || !landing.current) return;
    landing.current = false;
    if ((pathname === "/workflows" || pathname === "/chat") && !can("agents")) navigate("/", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, access]);

  useEffect(() => {
    if (status !== "authenticated") return;
    // Neither Interval Setup nor the Dashboard: no projects to load (the screens say "No feature access")
    if (!projectsOpen) {
      setLoading(false);
      return;
    }

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
  }, [status, logout, projectsOpen]);

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

  // The brain plans from the running interval's goals (its workers link back to them)
  useEffect(() => {
    setRunningInterval(
      activeBridge ? { bridgeId: activeBridge._id, kind: activeBridge.interval?.kind ?? "human", goals: activeBridge.sessionGoals.map(({ id, text }) => ({ id, text })) } : null
    );
  }, [activeBridge]);

  /* =========================================================
     ⏱ RUNNING INTERVAL — draft bridge window, shown on every
     signed-in page so it stays open for the whole interval
     ========================================================= */

  // An agent interval (Continuum Brain works it) has its own window: no timer, the brain's tasks and verdicts
  const endAgentInterval = useCallback(() => {
    setActiveBridge(null);
    setBridgeRevision((r) => r + 1);
  }, []);
  const draftModal = activeBridge && (activeBridge.interval?.kind === "agent" ? (
    <AgentBridge bridge={activeBridge} docked={pathname === "/brain" || pathname === "/chat"} onEnded={endAgentInterval} />
  ) : (
    <BridgeDraftModal
      bridge={activeBridge}
      // Agents and Chat: a panel in the corner, so the agents and the chat stay in view
      docked={pathname === "/brain" || pathname === "/chat"}
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
  ));

  /* =========================================================
     🔒 AUTH GATES
     ========================================================= */

  // The Legal page and the page about Continuum: open to everyone, signed in or not
  if (pathname === "/legal") return <LegalPage />;
  if (pathname === "/about") return <Landing />;
  if (status === "checking") return null;
  if (pathname === "/auth/callback") {
    return <AuthCallback />;
  }
  // Signed out: the public page about Continuum at /, the sign-in card anywhere else (/signin, or a link into the app)
  if (status === "unauthenticated") return pathname === "/" ? <Landing /> : <AuthGate />;
  // Signed in already: /signin goes on to Chat
  if (pathname === "/signin") return <Navigate to="/workflows" replace />;

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

  // An action your role has switched off (Deploy, Import from device…) lands here
  if (pathname === "/no-access") {
    return (
      <PageShell scroll>
        <NoAccess feature={locationState?.feature ?? "admin"} />
      </PageShell>
    );
  }

  if (pathname === "/import" && !can("import_github")) {
    return (
      <PageShell scroll>
        <NoAccess feature="import_github" />
      </PageShell>
    );
  }

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
     ✨ NEW PROJECT (/new) — the wizard: kind, type, dependencies,
     details, git, then the project is written to a device folder
     ========================================================= */

  // Workspaces (/workspaces) is a console screen (screens/registry.jsx): Projects and Bridges beside it

  if (pathname === "/new" && !can("create")) {
    return (
      <PageShell scroll>
        <NoAccess feature="create" />
      </PageShell>
    );
  }

  if (pathname === "/new") {
    return (
      <PageShell scroll>
        <Suspense fallback={null}>
        <NewProject
          onCreated={(project) => {
            setProjects((prev) => [...prev.filter((p) => p._id !== project._id), project]);
            setSelectedProject(project);
            navigate("/console");
          }}
          onEmptyProject={() => navigate("/console", { state: { createEmpty: true } })}
          onCancel={() => navigate(locationState?.from ?? "/console")}
        />
        </Suspense>
        {draftModal}
      </PageShell>
    );
  }

  /* =========================================================
     🏠 HOME (/) — the welcome page (sign-in lands on Chat; roles
     without Agents land here).
     The console lives at /console.
     ========================================================= */

  if (!screenForPath(pathname)) {
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
     🧭 SCREENS — the console's panes come from the current
     screen (screens/registry.jsx: Interval Setup, Agents, Dashboard)
     ========================================================= */

  const screen = screenForPath(pathname);

  const intervalCenter = (
    <>
      {/* Phones: Continuum creates on its server, the code lives in GitHub */}
      <PhoneCard onCreate={() => navigate("/new")} onWorkspaces={() => navigate("/workspaces")} />
      {projects.length === 0 ? (
        <EmptyConsole onCreateProject={() => navigate("/new")} />
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
    </>
  );

  // Dashboard (profile menu): the overview, in the console's middle pane
  const dashboardCenter = (
    <Dashboard
      projects={projects}
      activeProject={activeProject}
      activeBridge={activeBridge}
      bridgeRevision={bridgeRevision}
      onSelectProject={setSelectedProject}
      onOpenInterval={() => navigate("/console")}
    />
  );

  // Workspaces: a browser editor per project; the project picked on the left (or the one a link named) is preselected
  const workspacesCenter = (
    <Suspense fallback={null}>
      <Workspaces
        projects={projects}
        initialProjectId={locationState?.projectId ?? selectedProject?._id ?? null}
        selectedProjectId={selectedProject?._id ?? null}
        onProjectChanged={(p) => setProjects((prev) => prev.map((x) => (x._id === p._id ? { ...x, ...p } : x)))}
      />
    </Suspense>
  );

  // A screen your role has switched off: "No feature access" in its panes
  const slots =
    screen.feature && !can(screen.feature)
      ? { left: <NoAccess feature={screen.feature} compact />, center: <NoAccess feature={screen.feature} />, right: <NoAccess feature={screen.feature} compact /> }
      : screen.slots({ intervalCenter, dashboardCenter, workspacesCenter, navigate });

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
        onCreateProject={() => navigate("/new")}
        onActivateProject={(project) => (setProjectForAction(project), setShowActivateProject(true))}
        onEditProject={(project) => (setProjectForAction(project), setShowEditProject(true))}
        onDeleteProject={(project) => (setProjectForAction(project), setShowDeleteProject(true))}
        leftPane={slots.left ?? null}
        rightPane={slots.right ?? null}
        full={screen.full ?? false}
        leftLabel={screen.left.label}
        rightLabel={screen.right.label}
      >
        {slots.center}
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
              githubRepoUrl={createPrefill?.githubRepoUrl ?? null}
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
          initialProject={projectForAction ?? selectedProject}
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
          initialProject={projectForAction}
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
          initialProject={projectForAction}
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
