import React from "react";
import "./ProjectList.css";

export default function ProjectList({
  projects,
  activeProject,
  selectedProject,
  onSelectProject,
  onCreateProject,
}) {
  return (
    <div className="project-pane">
      {/* Header */}
      <div className="project-pane-header">
        <span className="project-pane-title">Projects</span>
        <button
          className="project-add"
          onClick={onCreateProject}
          title="Create project"
        >
          +
        </button>
      </div>

      {/* Project List */}
      <div className="project-list">
        {projects.map((project) => {
          const isActive =
            activeProject &&
            project._id === activeProject._id;

          const isSelected =
            selectedProject &&
            project._id === selectedProject._id;

          return (
            <button
              key={project._id}
              type="button"
              onClick={() => onSelectProject(project)}
              className={`
                project-item
                ${isSelected ? "selected" : ""}
                ${isActive ? "active" : ""}
              `}
            >
              {/* Active indicator = working */}
              {isActive && (
                <span
                  className="active-indicator"
                  title="Active project"
                />
              )}

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
