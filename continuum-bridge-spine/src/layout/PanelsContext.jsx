import { createContext, useContext } from "react";

/**
 * The console's side panes on narrow screens (under 900px): Projects slides in
 * from the left, Bridge Spine from the right. The header's buttons open them;
 * the three-panel layout shows them. Wide screens show both panes all the time
 * and ignore this.
 *
 * { enabled, panel: null | "projects" | "bridges", open(panel), close(), toggle(panel) }
 */
export const PanelsContext = createContext({
  enabled: false,
  panel: null,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function usePanels() {
  return useContext(PanelsContext);
}
