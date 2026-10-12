import ShellHeader from "./ShellHeader";

import "./PageShell.css";

/**
 * PageShell
 * ---------
 * Wraps every signed-in page so they all share the same header.
 * - scroll: the page body scrolls under the header (Welcome, Help,
 *   GitHub import); leave off for the three-panel console.
 * - selectedProject: the project chosen in the console's project pane;
 *   Deploy on <cloud> deploys it.
 */
export default function PageShell({ children, scroll = false, selectedProject = null }) {
  return (
    <div className="page-shell">
      <ShellHeader selectedProject={selectedProject} />
      {scroll ? <div className="page-shell-body">{children}</div> : children}
    </div>
  );
}
