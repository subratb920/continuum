import { useState } from "react";
import { Link } from "react-router-dom";
import { createProject } from "../api";
import { useAuth } from "../state/authStore";
import { overview } from "../content/continuumGuide";
import PowerOfContinuum from "../components/PowerOfContinuum";
import { onPhone } from "../utils/device";

import "./Welcome.css";

/**
 * Welcome
 * -------
 * Home page (/) once signed in, from the header title (sign-in lands on
 * Chat; before sign-in / is the public page, Landing).
 * Rendered inside PageShell, so it has the shared header.
 * The user can create a project or continue to the console (/console).
 */
export default function Welcome({ projectCount = 0, activeProject, onCreated, onContinue }) {
  const { user, authProvider, logout } = useAuth();
  const hasProjects = projectCount > 0;

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // On a phone projects are made on Continuum's server and kept in GitHub (no name-only projects)
  const [phone] = useState(onPhone);

  async function handleCreate() {
    if (!name.trim() || creating) return;

    setError("");
    setCreating(true);

    try {
      const project = await createProject(name.trim());
      onCreated(project);
    } catch (err) {
      setError(err.message || "Could not create the project. Please try again.");
      setCreating(false);
    }
  }

  return (
    <div className="welcome">
      {/* About */}
      <section className="welcome-intro">
        <h1>{overview.title}</h1>
        <p className="welcome-tagline">{overview.tagline}</p>
        <p className="welcome-summary">{overview.summary}</p>
        <Link to="/help" className="welcome-help-link">
          How Continuum works →
        </Link>
      </section>

      {/* First project + account */}
      <div className="welcome-row">
        <section className="welcome-card welcome-create">
          <h2>{hasProjects ? "Create a new project" : "Create your first project"}</h2>
          <p className="welcome-muted">
            A project is a long-lived piece of software work with its own Bridge Spine.
          </p>

          {phone ? (
            <>
              <p className="welcome-muted">On your phone, Continuum creates the project on its own server and keeps the code in your GitHub.</p>
              <Link to="/new" className="welcome-btn welcome-new-project">
                Create on GitHub: React, Node, Spring, Python…
              </Link>
              {authProvider === "github" && (
                <Link to="/import" className="welcome-btn welcome-btn-secondary">
                  Import from GitHub
                </Link>
              )}
            </>
          ) : (
            <>
              <Link to="/new" className="welcome-btn welcome-new-project">
                Start from a template: React, Node, Spring, Python…
              </Link>
              <p className="welcome-muted welcome-or">or just name it:</p>

              <input
                className="welcome-input"
                value={name}
                placeholder="Project name"
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />

              {error && <p className="welcome-error">{error}</p>}

              <button
                type="button"
                className="welcome-btn welcome-btn-secondary"
                onClick={handleCreate}
                disabled={!name.trim() || creating}
              >
                {creating ? "Creating…" : "Create Project"}
              </button>
            </>
          )}
        </section>

        <section className="welcome-card welcome-account">
          <h2>Your account</h2>
          <p className="welcome-email">{user?.email}</p>
          <p className="welcome-muted">
            Signed in with {authProvider === "github" ? "GitHub" : "email"}
          </p>

          <p className="welcome-stat">
            Projects: <strong>{projectCount}</strong>
            <br />
            Active: <strong>{activeProject?.name ?? "None"}</strong>
          </p>

          <button type="button" className="welcome-signout" onClick={logout}>
            Sign out
          </button>
        </section>
      </div>

      {/* What Continuum can do: the features gliding by */}
      <section className="welcome-card welcome-power">
        <PowerOfContinuum lead={null} />
      </section>

      {/* Continue */}
      <div className="welcome-continue">
        <button
          type="button"
          className="welcome-btn welcome-btn-primary"
          onClick={onContinue}
          disabled={creating}
        >
          Continue to Continuum →
        </button>
        <p className="welcome-muted">
          {hasProjects
            ? "Pick up where you left off: your latest Bridge is in the Bridge Spine."
            : "You can create a project anytime from + in the Projects panel."}
        </p>
      </div>
    </div>
  );
}
