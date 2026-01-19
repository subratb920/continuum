import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";

export default function ThreePanelLayout({
  projects,
  activeProject,
  selectedProject,
  activeBridge,
  bridgeRevision,
  onSelectProject,
  onSelectBridge,
  onCreateProject,
  children,
}) {
  return (
    <div className="app">
      <aside className="left">
        <ProjectList
          projects={projects}
          activeProject={activeProject}
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
        />
      </aside>

      <main className="center">
        {children}
      </main>

      <aside className="right">
        <BridgeSpine
          selectedProject={selectedProject}
          bridgeRevision={bridgeRevision}
          onSelectBridge={onSelectBridge}
        />
      </aside>
    </div>
  );
}
