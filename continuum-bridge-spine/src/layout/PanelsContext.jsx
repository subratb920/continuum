import { createContext, useContext } from "react";

/**
 * The console on narrow screens (under 900px): one pane at a time fills the
 * main area, chosen from the header's ☰ menu. null is the screen's centre
 * (e.g. Interval Setup); "left" / "right" are its side panes (Projects and
 * Bridges on the Interval screen). Wide screens show all three panes and ignore this.
 *
 * { enabled, panel: null | "left" | "right" | "create" | "deploy", open(panel), close(), toggle(panel) }
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
