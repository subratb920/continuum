import { useState } from "react";
import { createPortal } from "react-dom";
import {
  activateProject,
  deactivateProject,
} from "../api";

import "./ActivateProjectModal.css";
import "./ProjectFormModal.css";

/**
 * ActivateProjectModal
 * --------------------
 * Only one project can be active at a time.
 * - Activate is the main action; it replaces the current active project.
 * - Deactivate is a separate secondary action, shown only when a
 *   project is active.
 * - The dropdown starts on the project selected in the list.
 */
export default function ActivateProjectModal({
  projects,
  activeProject,
  initialProject,
  onActivated,
  onDeactivated,
  onClose,
}) {
  const [selectedId, setSelectedId] = useState(initialProject?._id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isAlreadyActive = !!selectedId && selectedId === activeProject?._id;
  const willReplace = !!activeProject && !!selectedId && !isAlreadyActive;

  async function handleActivate() {
    setError("");
    setBusy(true);

    try {
      await activateProject(selectedId);
      onActivated(projects.find(p => p._id === selectedId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    setError("");
    setBusy(true);

    try {
      await deactivateProject();
      onDeactivated();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-window activate-modal project-form-modal">
        <h2>Activate Project</h2>

        <label className="field-label" htmlFor="activate-project-select">
          Select project to activate
        </label>

        <select
          id="activate-project-select"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setError("");
          }}
          className="project-select"
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map(p => (
            <option key={p._id} value={p._id}>
              {p.name}
              {p._id === activeProject?._id ? " (active)" : ""}
            </option>
          ))}
        </select>

        {willReplace && (
          <div className="field-hint">
            This will replace “{activeProject.name}” as your active project.
          </div>
        )}

        {isAlreadyActive && (
          <div className="field-hint">This project is already active.</div>
        )}

        {activeProject && (
          <div className="activate-current">
            <span>
              Currently active: <strong>{activeProject.name}</strong>
            </span>

            <button
              type="button"
              onClick={handleDeactivate}
              disabled={busy}
              className="activate-deactivate-btn"
            >
              Deactivate
            </button>
          </div>
        )}

        {error && <div className="field-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy} className="btn-secondary">
            Cancel
          </button>

          <button
            onClick={handleActivate}
            disabled={!selectedId || isAlreadyActive || busy}
            className="btn-primary"
          >
            {busy ? "Please wait…" : "Activate"}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById("modal-root")
  );
}
