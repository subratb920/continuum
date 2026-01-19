import { createPortal } from "react-dom";

export default function ProjectActionMenu({
  onCreate,
  onActivate,
  onClose,
}) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onCreate}>
          Create Project
        </button>

        {/* Disabled for now – placeholders */}
        <button disabled>
          Edit Project
        </button>

        <button disabled>
          Delete Project
        </button>

        <button onClick={onActivate}>
          Activate / Deactivate Project
        </button>

        <button onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.getElementById("modal-root")
  );
}
