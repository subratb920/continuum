import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";
import { usePanels } from "./PanelsContext";
import { CreatePane, DeployPane } from "./ViewPanes";

/**
 * The console: three panes, filled by the current screen (screens/registry.jsx).
 * By default projects · (the screen's centre) · Bridge Spine; a screen can put
 * its own pane on either side (leftPane / rightPane). Under 900px one pane at a
 * time fills the main area, chosen from the header's ☰ menu: the centre (the
 * default), the left or right pane, Create or Deploy. Choosing a project or a
 * bridge goes back to the centre.
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
  leftPane = null, // another left pane instead of the projects (e.g. the Dashboard's navigation)
  rightPane = null, // another right pane instead of the Bridge Spine (e.g. the Agents screen's inspector)
  leftLabel = "Projects",
  rightLabel = "Bridge Spine",
  children,
}) {
  const { panel, close } = usePanels();

  return (
    <div className={`app${panel ? ` app-view-${panel}` : ""}`}>
      <aside className="left" aria-label={leftLabel} id="console-projects">
        {leftPane ?? (
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
          onActivateProject={(project) => (close(), onActivateProject(project))}
          onEditProject={(project) => (close(), onEditProject(project))}
          onDeleteProject={(project) => (close(), onDeleteProject(project))}
        />
        )}
      </aside>

      <main className="center">
        {panel === "create" ? <CreatePane selectedProject={selectedProject} /> : panel === "deploy" ? <DeployPane selectedProject={selectedProject} /> : children}
      </main>

      <aside className="right" aria-label={rightLabel} id="console-bridges">
        {rightPane ?? (
        <BridgeSpine
          selectedProject={selectedProject}
          activeBridge={activeBridge}
          bridgeRevision={bridgeRevision}
          onSelectBridge={(b) => {
            onSelectBridge(b);
            close();
          }}
        />
        )}
      </aside>

    </div>
  );
}
