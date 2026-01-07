import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";

export default function ThreePanelLayout({
  projects,
  activeProject,
  activeBridge,
  bridgeRevision,
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
          onCreateProject={onCreateProject}
        />
      </aside>

      <main className="center">
        {children}
      </main>

      <aside className="right">
        <BridgeSpine
          activeProject={activeProject}
          bridgeRevision={bridgeRevision}
          onSelectBridge={onSelectBridge}
        />
      </aside>
    </div>
  );
}
