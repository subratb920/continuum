import React from "react";
import "./ProjectList.css";

export default function ProjectList({
  projects,
  activeProject,
  onCreateProject,
}) {
  return (
    <div className="project-pane">
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

      <div className="project-list">
        {projects.map((project) => {
          const isActive =
            activeProject && project._id === activeProject._id;

          return (
            <div
              key={project._id}
              className={`project-item ${isActive ? "active" : ""}`}
            >
              {isActive && <span className="active-indicator" />}
              <span className="project-name">{project.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
