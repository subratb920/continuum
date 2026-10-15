import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./ProjectList.css";
import { getProjectMeta } from "../models/project";
import { useAuth } from "../state/authStore";
import { importFromDevice } from "../utils/importFromDevice";
import { usePreferences } from "../utils/preferences";
import ProjectContents from "./ProjectContents";

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
          <button
            type="button"
            className="project-add"
            onClick={() => setShowMenu((s) => !s)}
            title="New project and project actions"
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            + New <span aria-hidden="true">▾</span>
          </button>

          {showMenu && (
            <div className="project-action-menu" role="menu">
              <button role="menuitem" onClick={() => run(onCreateProject)}>
                Create project
              </button>
              <button role="menuitem" onClick={() => run(() => importFromDevice())}>
                Import from device
              </button>
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
          <button type="button" className="project-empty-btn primary-action" onClick={() => importFromDevice()}>
            Import from device
          </button>
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
                      <button
                        type="button"
                        className="project-icon-btn"
                        aria-expanded={contentsOpen}
                        aria-label={`${contentsOpen ? "Hide" : "Show"} the contents of ${project.name}`}
                        title={contentsOpen ? "Hide contents" : "Show contents"}
                        onClick={() => toggleContents(project)}
                      >
                        <span aria-hidden="true">{contentsOpen ? "▾" : "▸"}</span>
                      </button>
                    )}
                    {project.githubRepoUrl && (
                      <a
                        href={project.githubRepoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="project-icon-btn project-link"
                        title="Open on GitHub"
                        aria-label={`Open ${project.name} on GitHub`}
                      >
                        <GithubMark />
                      </a>
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

/** GitHub's mark (Octicons mark-github, MIT), drawn in the text colour. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.37A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
