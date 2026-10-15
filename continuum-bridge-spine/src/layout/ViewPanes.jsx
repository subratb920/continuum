import { useAuth } from "../state/authStore";
import { useShellActions } from "./shellActions";
import { createItems, deployItems } from "./menuItems";
import "./ViewPanes.css";

/**
 * Small screens: what + Create and Deploy offer, as panes in the main area
 * (chosen from the header's ☰ menu) instead of header menus.
 */

function Option({ item }) {
  return (
    <>
      {item.divider && <div className="view-options-divider" role="separator" />}
      <button type="button" className="view-option" onClick={item.onClick} disabled={item.disabled}>
        <span className="view-option-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="view-option-text">
          <strong>{item.title}</strong>
          <span className="view-option-hint">{item.hint}</span>
        </span>
      </button>
    </>
  );
}

export function CreatePane({ selectedProject }) {
  const { authProvider } = useAuth();
  const actions = useShellActions(selectedProject);
  return (
    <section className="view-pane" aria-label="Create">
      <h2 className="view-pane-title">Create</h2>
      <div className="view-options">
        {createItems(actions, authProvider).map((item) => (
          <Option key={item.key} item={item} />
        ))}
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
          "No project selected: each cloud opens its own page."
        )}
      </p>
      <div className="view-options">
        {deployItems(actions).map((item) => (
          <Option key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}
