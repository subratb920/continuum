import { useState } from "react";
import { createPortal } from "react-dom";
import { renameProject } from "../api";

import "./ActivateProjectModal.css";
import "./ProjectFormModal.css";

const MAX_NAME_LENGTH = 100;
const DUPLICATE_MESSAGE = "Project with same name already exists";

// Names are compared trimmed and case-insensitively
const normalize = (name) => name.trim().toLowerCase();

/**
 * EditProjectModal
 * ----------------
 * Rename any project (name is the only editable property).
 * Save stays disabled while the name is blank, unchanged
 * (capitalization alone doesn't count) or used by another project.
 */
export default function EditProjectModal({ projects, onRenamed, onClose }) {
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const project = projects.find(p => p._id === selectedId);
  const cleanName = name.trim();

  const isUnchanged = !!project && normalize(name) === normalize(project.name);
  const isDuplicate =
    !!project &&
    !isUnchanged &&
    projects.some(
      p => p._id !== project._id && normalize(p.name) === normalize(name)
    );
  const isTooLong = cleanName.length > MAX_NAME_LENGTH;

  const canSave =
    !!project && !!cleanName && !isUnchanged && !isDuplicate && !isTooLong && !saving;

  function handleSelect(id) {
    setSelectedId(id);
    setName(""); // new name starts empty; the current name is shown separately
    setError("");
  }

  async function handleSave() {
    if (!canSave) return;

    setError("");
    setSaving(true);

    try {
      const updated = await renameProject(selectedId, cleanName);
      onRenamed(updated);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-window activate-modal project-form-modal">
        <h2>Edit Project</h2>

        <label className="field-label" htmlFor="edit-project-select">
          Select project to rename
        </label>

        <select
          id="edit-project-select"
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          className="project-select"
        >
          <option value="" disabled>
            Select a project to edit
          </option>
          {projects.map(p => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>

        {project && (
          <>
            <div className="field-label">Current name</div>
            <div className="current-name">{project.name}</div>

            <label className="field-label" htmlFor="edit-project-name">
              New name
            </label>

            <input
              id="edit-project-name"
              className="project-name-input"
              value={name}
              placeholder="Enter the new project name"
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />

            {isDuplicate && <div className="field-error">{DUPLICATE_MESSAGE}</div>}

            {isTooLong && (
              <div className="field-error">
                Project name must be {MAX_NAME_LENGTH} characters or fewer.
              </div>
            )}

            {error && <div className="field-error">{error}</div>}

            {project.source === "github" && (
              <div className="field-hint">
                This renames the project in Continuum only. The GitHub
                repository isn't renamed.
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>

          <button onClick={handleSave} disabled={!canSave} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById("modal-root")
  );
}
