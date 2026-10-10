import { Link } from "react-router-dom";
import { gettingStarted } from "../content/continuumGuide";

import "./EmptyConsole.css";

/**
 * EmptyConsole
 * ------------
 * Centre panel when the user has no projects.
 */
export default function EmptyConsole({ onCreateProject }) {
  return (
    <div className="empty-console">
      <p>You don't have any projects yet.</p>

      <button type="button" className="primary" onClick={onCreateProject}>
        Create Project
      </button>

      <h3>{gettingStarted.title}</h3>
      <ol>
        {gettingStarted.steps.map((step, i) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            {i === 0 && <span className="you-are-here"> ← you are here</span>}
          </li>
        ))}
      </ol>

      <Link to="/help">How Continuum works →</Link>
    </div>
  );
}
