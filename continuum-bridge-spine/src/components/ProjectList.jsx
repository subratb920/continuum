import React, { useEffect, useState } from "react";
import "./ProjectList.css";
import { getProjectMeta } from "../models/project";

/**
 * ProjectList
 * -----------
 * - Selecting a project ≠ activating it
 * - Active project is driven ONLY by backend execution state
 * - Selected project controls what is being viewed
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

  /* ---------------------------------------------------------
     Close menu on outside click
     --------------------------------------------------------- */
  useEffect(() => {
    if (!showMenu) return;

    function handleOutsideClick(e) {
      if (!e.target.closest(".project-menu-anchor")) {
        setShowMenu(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () =>
      document.removeEventListener("mousedown", handleOutsideClick);
  }, [showMenu]);

  // Edit / Delete / Activate need at least one project to pick from
  const hasProjects = projects.length > 0;

  return (
    <div className="project-pane">
      {/* ----------------------------------
         Header
      ---------------------------------- */}
      <div className="project-pane-header">
        <span className="project-pane-title">Projects</span>

        <div className="project-menu-anchor">
          <button
            type="button"
            className="project-add"
            onClick={() => setShowMenu(true)}
            title="Project actions"
            aria-label="Project actions"
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            +
          </button>

          {showMenu && (
            <div
              className="project-action-menu"
              role="menu"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setShowMenu(false);
                  onCreateProject();
                }}
              >
                Create Project
              </button>

              <button
                role="menuitem"
                disabled={!hasProjects}
                onClick={() => {
                  setShowMenu(false);
                  onEditProject();
                }}
              >
                Edit Project
              </button>

              <button
                role="menuitem"
                disabled={!hasProjects}
                onClick={() => {
                  setShowMenu(false);
                  onDeleteProject();
                }}
              >
                Delete Project
              </button>

              <button
                role="menuitem"
                disabled={!hasProjects}
                onClick={() => {
                  setShowMenu(false);
                  onActivateProject(selectedProject);
                }}
              >
                Activate Project
              </button>


              <hr />

              <button
                role="menuitem"
                onClick={() => setShowMenu(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------------
         Project List
      ---------------------------------- */}
      <div className="project-list">
        {!hasProjects && (
          <p className="project-list-empty">No projects yet.</p>
        )}

        {projects.map((project) => {
          const isActive =
            activeProject?._id === project._id;

          const isSelected =
            selectedProject?._id === project._id;

          return (
            <button
              key={project._id}
              type="button"
              onClick={() => onSelectProject(project)}
              className={[
                "project-item",
                isSelected && "selected",
                isActive && "active",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isSelected}
            >
              {/* Status indicator — ALWAYS rendered */}
              <span
                className={[
                  "project-indicator",
                  isActive && "indicator-active",
                  !isActive && isSelected && "indicator-selected",
                  !isActive && !isSelected && "indicator-inactive",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              />

              <div className="project-content">
                <span className="project-name">
                  {project.name}
                </span>

                <span className="project-meta">
                  {getProjectMeta(project).icon}{" "}
                  {getProjectMeta(project).label}
                </span>
              </div>
              {project.githubRepoUrl && (
                <a
                  href={project.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="project-link"
                  title="Open on GitHub"
                  aria-label={`Open ${project.name} on GitHub`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GithubMark />
                </a>
              )}
            </button>
          );
        })}
      </div>
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
