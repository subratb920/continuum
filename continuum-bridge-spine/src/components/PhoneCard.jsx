import { useState } from "react";
import { canCreateFolders } from "../utils/deviceFolder";
import "./PhoneCard.css";

const DISMISSED_KEY = "continuum.phoneCard.dismissed";

/** A phone or tablet: a touch screen and no way to write project folders to the device. */
function onPhone() {
  return !canCreateFolders() && typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * On a phone, once (until "Not now"): Continuum can create projects on its
 * server and keep the code in the user's GitHub, since the phone can't hold
 * the project's folder.
 */
export default function PhoneCard({ onCreate, onWorkspaces }) {
  const [hidden, setHidden] = useState(() => !onPhone() || wasDismissed());
  if (hidden) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode: it just shows again next time
    }
    setHidden(true);
  }

  return (
    <aside className="phone-card" aria-label="Using Continuum on your phone">
      <span className="phone-card-icon" aria-hidden="true">
        📱
      </span>
      <div className="phone-card-text">
        <strong>You're on your phone</strong>
        <p>Continuum can create projects on its own server and keep the code in your GitHub, and open a workspace (VS Code in the browser) to work on them from here.</p>
        <div className="phone-card-actions">
          <button type="button" className="phone-card-primary" onClick={onCreate}>
            Create a project
          </button>
          <button type="button" className="phone-card-later" onClick={onWorkspaces}>
            Open a workspace
          </button>
          <button type="button" className="phone-card-later" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}
