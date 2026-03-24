import { createPortal } from "react-dom";

export default function ProjectActionMenu({
  onCreate,
  onActivate,
  onClose,
}) {
  return (
    <div className="project-action-menu">
      <button onClick={onCreate}>
        Create Project
      </button>

      <button disabled>
        Edit Project
      </button>

      <button disabled>
        Delete Project
      </button>

      <button onClick={onActivate}>
        Activate / Deactivate Project
      </button>

      <hr />

      <button onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

