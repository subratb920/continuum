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
      {/* ---------------------------------
          LEFT PANEL — Projects
         --------------------------------- */}
      <aside className="left">
        <ProjectList
          projects={projects}
          activeProject={activeProject}
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
        />
      </aside>

      {/* ---------------------------------
          CENTER PANEL — Execution Surface
         --------------------------------- */}
      <main className="center">
        {children}
      </main>

      {/* ---------------------------------
          RIGHT PANEL — Bridge Spine
         --------------------------------- */}
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
