import { DashboardNav } from "../components/Dashboard";
import { BrainProvider } from "../brain/BrainProvider";
import { usePendingCount } from "../brain/brainContext";
import AgentRoster from "./brain/AgentRoster";
import AgentStage from "./brain/AgentStage";
import AgentInspector from "./brain/AgentInspector";
import { DataProvider } from "../data/DataProvider";
import { useBuildingCount } from "../data/dataContext";
import { DATA_ENABLED } from "../data/dataApi";
import DataLibrary from "./data/DataLibrary";
import DataWorkbench from "./data/DataWorkbench";
import DataInspector from "./data/DataInspector";

/**
 * The console's screens: each one fills the three panes (left · centre · right)
 * under the shared header. The header's switcher and the ☰ menu are built from
 * this list, so a new screen is one entry here (and its components).
 *
 *   id, path, label, icon
 *   switcher: shown in the header's switcher (false: reached some other way)
 *   left / center / right: { label, icon } of each pane, for the ☰ menu
 *   slots(ctx): { left?, center, right? }, the panes' content; a missing side
 *     pane keeps the console's own (Projects on the left, Bridge Spine on the right)
 *   Provider: state the screen keeps while another screen shows (see ScreenProviders.jsx)
 *   useBadge(): a count beside the switcher button (a hook, called on every render)
 *   feature: what your role must have switched on (access/features); off, the
 *     screen shows "No feature access" (and the switcher a lock)
 *
 * ctx comes from App: { intervalCenter, dashboardCenter, navigate }
 */
export const SCREENS = [
  {
    id: "interval",
    feature: "interval",
    path: "/console",
    label: "Interval Setup",
    icon: "⏱",
    switcher: true,
    left: { label: "Projects", icon: "📂" },
    center: { label: "Interval Setup", icon: "⏱" },
    right: { label: "Bridges", icon: "🌉" },
    slots: (ctx) => ({ center: ctx.intervalCenter }),
  },
  {
    id: "agents",
    feature: "agents",
    path: "/brain",
    label: "Agents",
    icon: "✦",
    switcher: true,
    left: { label: "Agents", icon: "✦" },
    center: { label: "Agent Stage", icon: "◎" },
    right: { label: "Inspector", icon: "☰" },
    Provider: BrainProvider,
    useBadge: usePendingCount,
    slots: () => ({ left: <AgentRoster />, center: <AgentStage />, right: <AgentInspector /> }),
  },
  // Datasets (continuum-data): only when the engine is switched on (VITE_DATA_ENABLED)
  ...(DATA_ENABLED
    ? [
        {
          id: "data",
          feature: "data",
          path: "/data",
          label: "Data",
          icon: "▦",
          switcher: true,
          left: { label: "Library", icon: "📚" },
          center: { label: "Workbench", icon: "▦" },
          right: { label: "Profile", icon: "📈" },
          Provider: DataProvider,
          useBadge: useBuildingCount,
          slots: () => ({ left: <DataLibrary />, center: <DataWorkbench />, right: <DataInspector /> }),
        },
      ]
    : []),
  {
    id: "dashboard",
    feature: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
    icon: "📊",
    switcher: false, // the profile menu opens it
    left: { label: "Sections", icon: "📑" },
    center: { label: "Dashboard", icon: "📊" },
    right: { label: "Bridges", icon: "🌉" },
    slots: (ctx) => ({ left: <DashboardNav onIntervalSetup={() => ctx.navigate("/console")} />, center: ctx.dashboardCenter }),
  },
];

/** The console screen at this path, or null (another page). */
export function screenForPath(pathname) {
  return SCREENS.find((s) => s.path === pathname) ?? null;
}
