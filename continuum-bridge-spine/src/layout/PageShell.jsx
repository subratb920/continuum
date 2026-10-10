import ShellHeader from "./ShellHeader";

import "./PageShell.css";

/**
 * PageShell
 * ---------
 * Wraps every signed-in page so they all share the same header.
 * - scroll: the page body scrolls under the header (Welcome, Help,
 *   GitHub import); leave off for the three-panel console.
 */
export default function PageShell({ children, scroll = false }) {
  return (
    <div className="page-shell">
      <ShellHeader />
      {scroll ? <div className="page-shell-body">{children}</div> : children}
    </div>
  );
}
