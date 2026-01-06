import React from "react";
import "./ProjectList.css";

export default function ProjectList({ projects, activeProject }) {
  return (
    <div className="project-pane">
      <div className="project-pane-title">
        Projects
      </div>

      <div className="project-cards">
        {projects.map((project) => {
          const isActive =
            activeProject &&
            project._id === activeProject._id;

          return (
            <div
              key={project._id}
              className={`project-card ${
                isActive ? "active" : ""
              }`}
            >
              {project.name}
            </div>
          );
        })}
      </div>
    </div>
  );
}
