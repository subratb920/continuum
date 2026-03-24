import React, { useEffect, useState } from "react";
import "./ProjectList.css";

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

              <button disabled role="menuitem">
                Edit Project
              </button>

              <button disabled role="menuitem">
                Delete Project
              </button>

              <button
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

              <span className="project-name">
                {project.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
