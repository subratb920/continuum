import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./ProjectList.css";
import { getProjectMeta } from "../models/project";
import { useAuth } from "../state/authStore";
import { importFromDevice } from "../utils/importFromDevice";
import { usePreferences } from "../utils/preferences";
import ProjectContents from "./ProjectContents";
import Tip from "./Tip";
import { onPhone } from "../utils/device";
import { LuMonitor, LuSquarePen } from "react-icons/lu";

/** github.com/owner/repo → github.dev/owner/repo (GitHub's editor in the browser); null otherwise */
function githubDevUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m ? `https://github.dev/${m[1]}` : null;
}

/** Above this many projects the pane shows a search box. */
const SEARCH_FROM = 8;

/**
 * ProjectList
 * -----------
 * - Selecting a project ≠ activating it
 * - Active project is driven ONLY by backend execution state
 * - Selected project controls what is being viewed
 * - The active project comes first, then the rest A–Z
 * - A project imported from a device can show its contents (files) under it
 * - Project action menu is locally anchored (no portals)
 */
export default function ProjectList({
  projects,
  activeProject,
  selectedProject,
  onSelectProject,
  onCreateProject,
  onActivateProject,
  onEditProject,
  onDeleteProject,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [query, setQuery] = useState("");
  // A device project's contents stay collapsed until its ▸ is clicked (id → open), unless Settings says otherwise
  const [contentsToggled, setContentsToggled] = useState({});
  const { authProvider } = useAuth();
  const navigate = useNavigate();
  // On a phone projects are made on Continuum's server and kept in GitHub, never on the device
  const [phone] = useState(onPhone);
  const { pathname } = useLocation();

  /* ---------------------------------------------------------
     Close menu on outside click or Escape
     --------------------------------------------------------- */
  useEffect(() => {
    if (!showMenu) return;

    function handleOutsideClick(e) {
      if (!e.target.closest(".project-menu-anchor")) {
        setShowMenu(false);
      }
    }
    function handleKey(e) {
      if (e.key === "Escape") setShowMenu(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showMenu]);

  // Edit / Delete / Activate need at least one project to pick from
  const hasProjects = projects.length > 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isActive = (p) => activeProject?._id === p._id;
    return projects
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (isActive(a) !== isActive(b) ? (isActive(a) ? -1 : 1) : a.name.localeCompare(b.name)));
  }, [projects, query, activeProject]);

  function run(action) {
    setShowMenu(false);
    action();
  }
  const importGithub = () => navigate("/import", { state: { from: pathname } });
  const canImportGithub = authProvider === "github";
  // Settings → Projects: a device project's files may open when it's selected
  const { openFilesOnSelect } = usePreferences();
  const isContentsOpen = (project) => contentsToggled[project._id] ?? (openFilesOnSelect && selectedProject?._id === project._id);
  const toggleContents = (project) => setContentsToggled((t) => ({ ...t, [project._id]: !isContentsOpen(project) }));

  return (
    <div className="project-pane">
      {/* ----------------------------------
         Header
      ---------------------------------- */}
      <div className="project-pane-header">
        <h2 className="project-pane-title">
          Projects
          {hasProjects && <span className="project-count">{projects.length}</span>}
        </h2>

        <div className="project-menu-anchor">
          <Tip text="Projects menu" detail="New project, import, activate, edit or delete">
            <button
              type="button"
              className="project-add"
              onClick={() => setShowMenu((s) => !s)}
              aria-label="New project and project actions"
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <GearIcon />
            </button>
          </Tip>

          {showMenu && (
            <div className="project-action-menu" role="menu">
              <button role="menuitem" onClick={() => run(onCreateProject)}>
                {phone ? "Create on GitHub" : "Create project"}
              </button>
              {/* A phone can't hold a project: nothing is imported from it */}
              {!phone && (
                <button role="menuitem" onClick={() => run(() => importFromDevice())}>
                  Import from device
                </button>
              )}
              <button role="menuitem" disabled={!canImportGithub} title={canImportGithub ? undefined : "Sign in with GitHub to import a repository"} onClick={() => run(importGithub)}>
                Import from GitHub
              </button>

              <hr />

              <button role="menuitem" disabled={!hasProjects} onClick={() => run(onEditProject)}>
                Edit project
              </button>
              <button role="menuitem" disabled={!hasProjects} onClick={() => run(() => onActivateProject(selectedProject))}>
                Activate project
              </button>
              <button role="menuitem" className="danger" disabled={!hasProjects} onClick={() => run(onDeleteProject)}>
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>

      {projects.length > SEARCH_FROM && (
        <input
          type="search"
          className="project-search"
          placeholder="Search projects"
          aria-label="Search projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {/* ----------------------------------
         Project List
      ---------------------------------- */}
      {!hasProjects ? (
        <div className="project-list-empty">
          <p>No projects yet.</p>
          {phone ? (
            <button type="button" className="project-empty-btn primary-action" onClick={onCreateProject}>
              Create on GitHub
            </button>
          ) : (
            <button type="button" className="project-empty-btn primary-action" onClick={() => importFromDevice()}>
              Import from device
            </button>
          )}
          <button type="button" className="project-empty-btn" disabled={!canImportGithub} onClick={importGithub}>
            Import from GitHub
          </button>
        </div>
      ) : (
        <ul className="project-list">
          {shown.length === 0 && <li className="project-list-none">No project matches “{query}”.</li>}

          {shown.map((project) => {
            const isActive = activeProject?._id === project._id;
            const isSelected = selectedProject?._id === project._id;
            const meta = getProjectMeta(project);
            const hasContents = project.source === "device" && project.contents;
            const contentsOpen = Boolean(hasContents) && isContentsOpen(project);
            const status = isActive ? "Active" : isSelected ? "Selected" : null;

            return (
              <li key={project._id} className="project-entry">
                <div className={["project-item", isSelected && "selected", isActive && "active"].filter(Boolean).join(" ")}>
                  <button
                    type="button"
                    className="project-select"
                    onClick={() => onSelectProject(project)}
                    aria-current={isSelected ? "true" : undefined}
                    title={project.name}
                  >
                    {/* Status indicator — ALWAYS rendered */}
                    <span
                      className={["project-indicator", isActive && "indicator-active", !isActive && isSelected && "indicator-selected", !isActive && !isSelected && "indicator-inactive"].filter(Boolean).join(" ")}
                      aria-hidden="true"
                    />

                    <span className="project-content">
                      <span className="project-name">{project.name}</span>

                      <span className="project-meta">
                        <span className={`project-tag tag-${project.source === "github" ? project.visibility : project.source}`}>
                          {meta.icon} {meta.label}
                        </span>
                        {status && <span className={`project-status status-${status.toLowerCase()}`}>{status}</span>}
                      </span>
                    </span>
                  </button>

                  <span className="project-actions">
                    {hasContents && (
                      <Tip text={contentsOpen ? "Hide files" : "Show files"} detail="The project's files on this device">
                        <button
                          type="button"
                          className="project-icon-btn"
                          aria-expanded={contentsOpen}
                          aria-label={`${contentsOpen ? "Hide" : "Show"} the contents of ${project.name}`}
                          onClick={() => toggleContents(project)}
                        >
                          <span aria-hidden="true">{contentsOpen ? "▾" : "▸"}</span>
                        </button>
                      </Tip>
                    )}
                    {/* A workspace (VS Code with a terminal): any project (one without GitHub is put on GitHub first) */}
                    <Tip
                      text="Open a workspace"
                      detail={project.githubRepoUrl ? "VS Code in your browser, with a terminal" : "VS Code in your browser (puts the project on GitHub first)"}
                    >
                      <button
                        type="button"
                        className="project-icon-btn project-link"
                        aria-label={`Open a workspace for ${project.name}`}
                        onClick={() => navigate("/workspaces", { state: { projectId: project._id } })}
                      >
                        <LuMonitor aria-hidden="true" />
                      </button>
                    </Tip>
                    {/* Edit the repository in the browser (github.dev), from any device */}
                    {githubDevUrl(project.githubRepoUrl) && (
                      <Tip text="Edit in browser" detail="Quick edits on github.dev (no terminal)">
                        <a
                          href={githubDevUrl(project.githubRepoUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="project-icon-btn project-link"
                          aria-label={`Edit ${project.name} in the browser`}
                        >
                          <LuSquarePen aria-hidden="true" />
                        </a>
                      </Tip>
                    )}
                    {project.githubRepoUrl ? (
                      <Tip text="Open on GitHub" detail={project.githubRepoUrl.replace(/^https:\/\/github\.com\//, "")}>
                        <a
                          href={project.githubRepoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="project-icon-btn project-link"
                          aria-label={`Open ${project.name} on GitHub`}
                        >
                          <GithubMark />
                        </a>
                      </Tip>
                    ) : (
                      project.source === "device" && (
                        <Tip text="Not on GitHub" detail="This folder has no GitHub remote">
                          <span className="project-icon-btn project-link is-off" role="img" tabIndex={0} aria-label={`${project.name} has no GitHub remote`}>
                            <GithubMark />
                          </span>
                        </Tip>
                      )
                    )}
                  </span>
                </div>

                {hasContents && contentsOpen && <ProjectContents project={project} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A gear (Octicons gear, MIT), drawn in the text colour. */
function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z" />
    </svg>
  );
}

/** GitHub's mark (Octicons mark-github, MIT), drawn in the text colour. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.37A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
