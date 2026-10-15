import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";
import { usePanels } from "./PanelsContext";

/**
 * The console: projects · Interval Setup · Bridge Spine. Under 900px the two
 * side panes become drawers (opened from the header), with a scrim behind
 * them; choosing a project or a bridge closes the drawer.
 */
export default function ThreePanelLayout({
  projects,
  activeProject,
  selectedProject,
  activeBridge,
  bridgeRevision,
  onSelectProject,
  onSelectBridge,
  onCreateProject,
  onActivateProject,
  onEditProject,
  onDeleteProject,
  children,
}) {
  const { panel, close } = usePanels();

  return (
    <div className={`app${panel ? ` app-drawer-${panel}` : ""}`}>
      <aside className="left" aria-label="Projects" id="console-projects">
        <ProjectList
          projects={projects}
          activeProject={activeProject}
          selectedProject={selectedProject}
          onSelectProject={(p) => {
            onSelectProject(p);
            close();
          }}
          // Each opens a window: the drawer gets out of its way
          onCreateProject={() => (close(), onCreateProject())}
          onActivateProject={() => (close(), onActivateProject())}
          onEditProject={() => (close(), onEditProject())}
          onDeleteProject={() => (close(), onDeleteProject())}
        />
      </aside>

      <main className="center">
        {children}
      </main>

      <aside className="right" aria-label="Bridge Spine" id="console-bridges">
        <BridgeSpine
          selectedProject={selectedProject}
          bridgeRevision={bridgeRevision}
          onSelectBridge={(b) => {
            onSelectBridge(b);
            close();
          }}
        />
      </aside>

      {panel && <div className="app-scrim" onClick={close} aria-hidden="true" />}
    </div>
  );
}
