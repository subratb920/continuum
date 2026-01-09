import React from "react";
import "./ProjectList.css";

/**
 * ProjectList
 * -----------
 * - Selecting a project ≠ activating it
 * - Active project is driven ONLY by backend execution state
 * - Selected project controls what is being viewed
 */
export default function ProjectList({
  projects,
  activeProject,
  selectedProject,
  onSelectProject,
  onCreateProject,
}) {
  return (
    <div className="project-pane">
      {/* ----------------------------------
         Header
      ---------------------------------- */}
      <div className="project-pane-header">
        <span className="project-pane-title">Projects</span>

        <button
          type="button"
          className="project-add"
          onClick={onCreateProject}
          title="Create project"
          aria-label="Create project"
        >
          +
        </button>
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
