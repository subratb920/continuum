import { useEffect, useRef, useState } from "react";
import ProjectList from "../components/ProjectList";
import BridgeSpine from "../components/BridgeSpine";
import { usePanels } from "./PanelsContext";
import { CreatePane, DeployPane } from "./ViewPanes";

/**
 * The console: three panes, filled by the current screen (screens/registry.jsx).
 * By default projects · (the screen's centre) · Bridge Spine; a screen can put
 * its own pane on either side (leftPane / rightPane). Under 900px one part at a
 * time fills the main area: the centre (the default), the left or right pane
 * (on one track that slides, its labels in the parts bar moving with it),
 * Create or Deploy. The parts bar under the header (PhoneNav) and a swipe
 * that follows the finger move between them. Choosing a project or a bridge
 * goes back to the centre.
 */
const narrowQuery = "(max-width: 899px)";
const isNarrow = () => typeof window !== "undefined" && Boolean(window.matchMedia?.(narrowQuery).matches);
const POS = { left: 0, right: 2 };

/** Under 900px: true (one part at a time), kept up to date. */
function useNarrow() {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const q = window.matchMedia?.(narrowQuery);
    if (!q) return undefined;
    const on = () => setNarrow(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return narrow;
}

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
  full = false, // the middle only, the whole width: no side panes, no swipes (true; "narrow": only on phones, as Chat)
  children,
}) {
  const { panel, open, close } = usePanels();

  const narrow = useNarrow();
  const pos = POS[panel] ?? 1;
  const moving = panel !== "create" && panel !== "deploy";

  // A swipe moves the parts (and their labels) with the finger; letting go settles on the
  // nearest part: past a quarter of the width, or a quick flick, moves one part over.
  // At either end it gives way only a little. Vertical scrolling is left to the browser.
  const drag = useRef(null);
  function setDrag(shell, px) {
    shell?.style.setProperty("--part-drag", `${Math.round(px)}px`);
  }
  function onTouchStart(e) {
    if (!narrow || !moving || e.touches.length !== 1) return;
    const t = e.touches[0];
    drag.current = { x: t.clientX, y: t.clientY, t: performance.now(), axis: null, dx: 0, shell: e.currentTarget.closest(".page-shell"), width: e.currentTarget.clientWidth || 1 };
  }
  function onTouchMove(e) {
    const d = drag.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x;
    const dy = t.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") {
        drag.current = null; // scrolling: not ours
        return;
      }
      d.shell?.classList.add("parts-dragging");
    }
    // Nothing further that way: it gives way a third as much
    const atEnd = (dx > 0 && pos === 0) || (dx < 0 && pos === 2);
    d.dx = atEnd ? dx / 3 : dx;
    setDrag(d.shell, d.dx);
  }
  function onTouchEnd() {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x") return;
    d.shell?.classList.remove("parts-dragging");
    setDrag(d.shell, 0);
    const speed = Math.abs(d.dx) / Math.max(1, performance.now() - d.t); // px per ms
    const far = Math.abs(d.dx) > d.width / 4 || (speed > 0.5 && Math.abs(d.dx) > 30);
    if (!far) return; // settles back where it was
    const next = d.dx < 0 ? pos + 1 : pos - 1;
    if (next < 0 || next > 2) return;
    if (next === 1) close();
    else open(next === 0 ? "left" : "right");
  }

  // Small screens: the parts not showing are off to the side; keyboards and screen readers skip them
  const away = (n) => (narrow && moving && n !== pos ? true : undefined);
  const classes = ["app", panel && `app-view-${panel}`].filter(Boolean).join(" ");
  if (full === true || (full === "narrow" && narrow)) {
    return (
      <div className="app app-full">
        <main className="center">
          {panel === "create" ? <CreatePane selectedProject={selectedProject} /> : panel === "deploy" ? <DeployPane selectedProject={selectedProject} /> : children}
        </main>
      </div>
    );
  }
  return (
    <div className={classes} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <aside className="left" aria-label={leftLabel} id="console-projects" inert={away(0)}>
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

      <main className="center" inert={away(1)}>
        {panel === "create" ? <CreatePane selectedProject={selectedProject} /> : panel === "deploy" ? <DeployPane selectedProject={selectedProject} /> : children}
      </main>

      <aside className="right" aria-label={rightLabel} id="console-bridges" inert={away(2)}>
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
