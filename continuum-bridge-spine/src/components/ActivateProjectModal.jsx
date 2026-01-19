import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  activateProject,
  deactivateProject,
} from "../api";

import "./ActivateProjectModal.css";

export default function ActivateProjectModal({
  projects,
  activeProject,
  onActivated,
  onDeactivated,
  onClose,
}) {
  const [selectedId, setSelectedId] = useState(
    activeProject?._id || ""
  );
  const [loading, setLoading] = useState(false);
  const isActive = selectedId === activeProject?._id;

  async function handleAction() {
    setLoading(true);
    try {
      if (isActive) {
        await deactivateProject();
        onDeactivated();
      } else {
        await activateProject(selectedId);
        const project = projects.find(p => p._id === selectedId);
        onActivated(project);
      }
      onClose();
    } catch (err) {
      console.error("Execution update failed", err);
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-window activate-modal">
        <h2>Execution Context</h2>

        <label className="field-label">
          Project
        </label>

        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="project-select"
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map(p => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>

        {activeProject && (
          <div className="active-indicator">
            Active: <strong>{activeProject.name}</strong>
          </div>
        )}

        <div className="modal-actions">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>

          <button
            onClick={handleAction}
            disabled={!selectedId || loading}
            className={isActive ? "btn-danger" : "btn-primary"}
          >
            {loading
              ? "Please wait…"
              : isActive
              ? "Deactivate"
              : "Activate"}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById("modal-root")
  );
}
