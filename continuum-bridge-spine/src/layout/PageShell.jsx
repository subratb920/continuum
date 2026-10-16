import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ShellHeader from "./ShellHeader";
import PhoneNav from "./PhoneNav";
import { PanelsContext } from "./PanelsContext";
import { rememberPart } from "./parts";
import { screenForPath } from "../screens/registry";

import "./PageShell.css";

/**
 * PageShell
 * ---------
 * Wraps every signed-in page so they all share the same header.
 * - scroll: the page body scrolls under the header (Welcome, Help,
 *   GitHub import); leave off for the three-panel console.
 * - selectedProject: the project chosen in the console's project pane;
 *   Deploy on <cloud> deploys it.
 * - panels: the console's side panes. On narrow screens one part at a time
 *   fills the main area: the screen tabs and the parts bar under the header
 *   (PhoneNav) move between them, and so do swipes.
 *
 * The part shown lives in the page's history entry ({ part }): opening a side
 * part adds an entry, so the phone's Back button returns to the middle
 * instead of leaving the page; moving from one side to the other replaces it.
 */
export default function PageShell({ children, scroll = false, selectedProject = null, panels = false }) {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  // Small screens: which part fills the main area (null: the screen's middle)
  const panel = panels ? (location.state?.part ?? location.state?.view ?? null) : null;
  // Opened here (an entry of ours): closing goes back; arrived with one (a reload, a link): closing replaces it
  const pushed = useRef(false);

  const close = useCallback(() => {
    if (!panel) return;
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
    } else navigate(pathname, { replace: true, state: null });
  }, [panel, pathname, navigate]);

  const open = useCallback(
    (next) => {
      if (!next) return close();
      if (next === panel) return;
      if (!panel) pushed.current = true;
      navigate(pathname, { replace: Boolean(panel), state: { part: next } });
    },
    [panel, pathname, navigate, close]
  );

  // Back past our entry (the browser's or the phone's button): it's no longer ours to undo
  useEffect(() => {
    if (!panel) pushed.current = false;
  }, [panel]);

  // Each screen remembers its part (the screen tabs bring it back)
  const screen = panels ? screenForPath(pathname) : null;
  useEffect(() => {
    if (screen) rememberPart(screen.id, panel === "left" || panel === "right" ? panel : null);
  }, [screen, panel]);

  // Esc goes back to the middle; widening the window past 900px does too (all panes show)
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
      open,
      close,
      toggle: (p) => (p === panel ? close() : open(p)),
    }),
    [panels, panel, open, close]
  );

  return (
    <PanelsContext.Provider value={value}>
      {/* Small screens: where the parts track stands (0 left, 1 middle, 2 right), shared by the parts and the parts bar */}
      <div className="page-shell" style={{ "--part-pos": panel === "left" ? 0 : panel === "right" ? 2 : 1 }}>
        <ShellHeader selectedProject={selectedProject} />
        <PhoneNav />
        {scroll ? <div className="page-shell-body">{children}</div> : children}
      </div>
    </PanelsContext.Provider>
  );
}
