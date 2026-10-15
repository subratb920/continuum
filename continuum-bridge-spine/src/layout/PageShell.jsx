import { useCallback, useEffect, useMemo, useState } from "react";
import ShellHeader from "./ShellHeader";
import { PanelsContext } from "./PanelsContext";

import "./PageShell.css";

/**
 * PageShell
 * ---------
 * Wraps every signed-in page so they all share the same header.
 * - scroll: the page body scrolls under the header (Welcome, Help,
 *   GitHub import); leave off for the three-panel console.
 * - selectedProject: the project chosen in the console's project pane;
 *   Deploy on <cloud> deploys it.
 * - panels: the console's side panes, which open as drawers on narrow screens.
 */
export default function PageShell({ children, scroll = false, selectedProject = null, panels = false }) {
  const [panel, setPanel] = useState(null);
  const close = useCallback(() => setPanel(null), []);

  // Esc closes an open drawer; widening the window past the drawer size closes it too
  useEffect(() => {
    if (!panel) return;
    const onKey = (e) => e.key === "Escape" && close();
    const wide = window.matchMedia("(min-width: 900px)");
    const onWide = (e) => e.matches && close();
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [panel, close]);

  const value = useMemo(
    () => ({
      enabled: panels,
      panel,
      open: setPanel,
      close,
      toggle: (p) => setPanel((cur) => (cur === p ? null : p)),
    }),
    [panels, panel, close]
  );

  return (
    <PanelsContext.Provider value={value}>
      <div className="page-shell">
        <ShellHeader selectedProject={selectedProject} />
        {scroll ? <div className="page-shell-body">{children}</div> : children}
      </div>
    </PanelsContext.Provider>
  );
}
