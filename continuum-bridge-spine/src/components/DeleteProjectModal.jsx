import { useState } from "react";
import { createPortal } from "react-dom";
import { deleteProject, fetchBridges } from "../api";

import "./ActivateProjectModal.css";
import "./ProjectFormModal.css";

/**
 * DeleteProjectModal
 * ------------------
 * Step 1 (select):  choose any project from a dropdown.
 * Step 2 (confirm): warning with what will be lost.
 * Nothing is deleted until the user confirms in step 2.
 */
export default function DeleteProjectModal({
  projects,
  activeProject,
  onDeleted,
  onClose,
}) {
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState("select"); // select | confirm
  const [bridgeCount, setBridgeCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const project = projects.find(p => p._id === selectedId);
  const isActive = !!project && project._id === activeProject?._id;

  async function handleReview() {
    setError("");
    setLoading(true);

    try {
      const bridges = await fetchBridges(selectedId);
      setBridgeCount(bridges.length);
    } catch {
      // Count is informational only; still allow the confirmation step
      setBridgeCount(null);
    }

    setLoading(false);
    setStep("confirm");
  }

  async function handleConfirm() {
    setError("");
    setLoading(true);

    try {
      await deleteProject(selectedId);
      onDeleted(project);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function describeLoss() {
    if (bridgeCount === 0) {
      return <>This will permanently delete the project. It has no bridges.</>;
    }

    const bridges =
      bridgeCount === null
        ? "all of its bridges"
        : `its ${bridgeCount} bridge${bridgeCount === 1 ? "" : "s"}`;

    return (
      <>
        This will permanently delete the project and{" "}
        <strong>{bridges}</strong> (interval history).
      </>
    );
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-window activate-modal project-form-modal">
        {step === "select" ? (
          <>
            <h2>Delete Project</h2>

            <label className="field-label" htmlFor="delete-project-select">
              Project
            </label>

            <select
              id="delete-project-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="project-select"
            >
              <option value="" disabled>
                Select a project to delete
              </option>
              {projects.map(p => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="modal-actions">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>

              <button
                onClick={handleReview}
                disabled={!selectedId || loading}
                className="btn-danger"
              >
                {loading ? "Please wait…" : "Delete"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Delete “{project?.name}”?</h2>

            <div className="delete-warning" role="alert">
              <p>{describeLoss()}</p>

              {isActive && (
                <p>
                  This is your <strong>active project</strong>. It will be
                  deactivated.
                </p>
              )}

              <p>This cannot be undone.</p>
            </div>

            {error && <div className="delete-error">{error}</div>}

            <div className="modal-actions">
              <button
                onClick={() => setStep("select")}
                disabled={loading}
                className="btn-secondary"
              >
                No, keep it
              </button>

              <button
                onClick={handleConfirm}
                disabled={loading}
                className="btn-danger"
              >
                {loading ? "Deleting…" : "Yes, delete project"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.getElementById("modal-root")
  );
}
