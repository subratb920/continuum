import { createContext, useContext } from "react";

/**
 * The console on narrow screens (under 900px): one pane at a time fills the
 * main area, chosen from the header's ☰ menu. null is Interval Setup. Wide
 * screens show all three panes and ignore this.
 *
 * { enabled, panel: null | "projects" | "bridges" | "create" | "deploy", open(panel), close(), toggle(panel) }
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
