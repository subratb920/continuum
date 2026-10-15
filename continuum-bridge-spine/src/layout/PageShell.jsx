import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
 * - panels: the console's side panes; on narrow screens one pane at a time
 *   fills the main area, chosen from the header's ☰ menu.
 */
export default function PageShell({ children, scroll = false, selectedProject = null, panels = false }) {
  // Small screens: which pane fills the main area (null: Interval Setup). Another
  // page's ☰ menu brings its choice along (navigate state).
  const { state: navState, pathname } = useLocation();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(() => (panels ? (navState?.view ?? null) : null));
  const close = useCallback(() => setPanel(null), []);
  // Taken once (above, when the console mounts); dropped from history so a reload shows Interval Setup
  useEffect(() => {
    if (panels && navState?.view) navigate(pathname, { replace: true, state: null });
  }, [panels, navState, pathname, navigate]);

  // Esc goes back to Interval Setup; widening the window past 900px does too (all panes show)
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
