import { useAuth } from "../state/authStore";
import { CREATE_URL, DEPLOY_TARGETS, useShellActions } from "./shellActions";
import "./ViewPanes.css";

/**
 * Small screens: what + Create and Deploy offer, as panes in the main area
 * (chosen from the header's ☰ menu) instead of header menus.
 */

function Option({ icon, title, hint, onClick, disabled = false }) {
  return (
    <button type="button" className="view-option" onClick={onClick} disabled={disabled}>
      <span className="view-option-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="view-option-text">
        <strong>{title}</strong>
        {hint && <span className="view-option-hint">{hint}</span>}
      </span>
    </button>
  );
}

export function CreatePane({ selectedProject }) {
  const { authProvider } = useAuth();
  const actions = useShellActions(selectedProject);
  return (
    <section className="view-pane" aria-label="Create">
      <h2 className="view-pane-title">Create</h2>
      <div className="view-options">
        <Option icon="✨" title="New project" hint="Pick a stack (React, Node, Spring, Python…), its dependencies and git." onClick={actions.newProject} />
        <Option icon="📁" title="Import from device" hint="A project folder on this device." onClick={actions.importFromDevice} />
        <Option
          icon="📦"
          title="Import from GitHub"
          hint={authProvider === "github" ? "Your GitHub repositories." : "Sign in with GitHub to import a repository."}
          onClick={actions.importFromGithub}
          disabled={authProvider !== "github"}
        />
        {CREATE_URL && <Option icon="🚀" title="Create via Backstage" hint="Your organisation's templates." onClick={actions.externalCreate} />}
      </div>
    </section>
  );
}

export function DeployPane({ selectedProject }) {
  const actions = useShellActions(selectedProject);
  const { deployable } = actions;
  return (
    <section className="view-pane" aria-label="Deploy">
      <h2 className="view-pane-title">Deploy</h2>
      <p className="view-pane-note">
        {selectedProject ? (
          deployable ? (
            <>
              Selected project: <strong>{deployable.name}</strong>
            </>
          ) : (
            <>{selectedProject.name} has no GitHub repository to deploy.</>
          )
        ) : (
          "No project selected: each cloud opens its deployments."
        )}
      </p>
      <div className="view-options">
        <Option icon="🚀" title="Open Continuum Deploy" hint="All clouds, in a new tab." onClick={() => actions.openDeployApp(null)} />
        {DEPLOY_TARGETS.map((t) => (
          <Option
            key={t.label}
            icon="☁️"
            title={`Deploy on ${t.label}`}
            hint={t.soon ? "Coming soon" : t.deploysProject && deployable ? `Deploys ${deployable.name}` : undefined}
            onClick={() => actions.openDeployApp(t)}
          />
        ))}
      </div>
    </section>
  );
}
