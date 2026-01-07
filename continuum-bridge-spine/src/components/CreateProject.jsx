import { useState } from "react";
import { createProject } from "../api";
import "./BridgeHistoryModal.css"; // reuse same modal CSS

export default function CreateProject({ onCreated, onClose }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim() || creating) return;

    setCreating(true);
    const project = await createProject(name.trim());
    onCreated(project);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="modal-header">
          <h2>Create Project</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        {/* Body */}
        <section className="modal-body">
          <p className="modal-meta">
            A project represents a long-lived continuity spine.
          </p>

          <input
            autoFocus
            className="modal-input"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </section>

        {/* Footer */}
        {/* <footer className="modal-footer">
          <button onClick={onClose} className="secondary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="primary"
          >
            {creating ? "Creating…" : "Create Project"}
          </button>
        </footer> */}
      </div>
    </div>
  );
}
