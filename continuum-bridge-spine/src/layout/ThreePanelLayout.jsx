import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";

export default function ThreePanelLayout({ children }) {
  return (
    <div className="app">
      <aside className="left">
        <ProjectList />
      </aside>

      <main className="center">
        {children}
      </main>

      <aside className="right">
        <BridgeSpine />
      </aside>
    </div>
  );
}
