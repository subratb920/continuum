import { useEffect, useRef, useState } from "react";
import Tip from "./Tip";
import "./ProjectSettingsMenu.css";

const MENU_WIDTH = 200;
const MENU_HEIGHT = 120; // about: three items

/**
 * A project's settings gear (bottom right of its row, always shown, so a phone
 * reaches it without selecting the project first): Activate or Deactivate,
 * Edit and Delete that project. Each opens its usual window with this project
 * chosen. Opening the menu doesn't select the project.
 */
export default function ProjectSettingsMenu({ project, isActive, onActivate, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // where the menu sits on screen: below the gear, or above it near the bottom
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !wrap.current?.contains(e.target)) setOpen(false);
    };
    // The menu is placed on screen, so it closes when the list scrolls or the window resizes
    const away = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  function run(action) {
    setOpen(false);
    action(project);
  }

  return (
    <span className="psm" ref={wrap}>
      <Tip text="Project settings" detail={`Activate, edit or delete ${project.name}`}>
        <button
          type="button"
          className="project-icon-btn psm-btn"
          aria-label={`Settings: ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            // Fixed on screen (the project pane would clip it): ends at the gear's right
            // edge, below it, or above it when the gear is near the bottom of the screen
            const r = e.currentTarget.getBoundingClientRect();
            const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
            setPos(r.bottom + 4 + MENU_HEIGHT <= window.innerHeight ? { top: r.bottom + 4, left } : { bottom: window.innerHeight - r.top + 4, left });
            setOpen((o) => !o);
          }}
        >
          <GearIcon />
        </button>
      </Tip>
      {open && (
        <div className="psm-list" style={pos ?? undefined} role="menu" aria-label={`Settings: ${project.name}`}>
          <button role="menuitem" type="button" className="psm-item" onClick={() => run(onActivate)}>
            {isActive ? "Deactivate project" : "Activate project"}
          </button>
          <button role="menuitem" type="button" className="psm-item" onClick={() => run(onEdit)}>
            Edit project
          </button>
          <button role="menuitem" type="button" className="psm-item danger" onClick={() => run(onDelete)}>
            Delete project
          </button>
        </div>
      )}
    </span>
  );
}

/** A gear (Octicons gear, MIT), drawn in the text colour. */
export function GearIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z" />
    </svg>
  );
}
