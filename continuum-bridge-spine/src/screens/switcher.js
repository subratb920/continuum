import { SCREENS } from "./registry";

/** The switcher's screens, in tab order: Chat, Workflows, Agents, Interval Setup (and Data). */
export const SWITCHER = SCREENS.filter((s) => s.switcher).sort((a, b) => (a.tab ?? 99) - (b.tab ?? 99));
