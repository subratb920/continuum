import { BrainProvider } from "../brain/BrainProvider";
import { usePendingCount } from "../brain/brainContext";
import { WorkflowsProvider } from "../workflows/WorkflowsProvider";
import { DataProvider } from "../data/DataProvider";
import { useBuildingCount } from "../data/dataContext";
import { DATA_ENABLED } from "../data/dataApi";
import { deferred } from "../utils/deferred";

// Each screen's panes load when the screen is first opened (utils/deferred.jsx)
const DashboardNav = deferred(() => import("../components/Dashboard"), "DashboardNav");
const AgentRoster = deferred(() => import("./brain/AgentRoster"));
const AgentStage = deferred(() => import("./brain/AgentStage"));
const AgentInspector = deferred(() => import("./brain/AgentInspector"));
const BrainChat = deferred(() => import("./brain/BrainChat"));
const BrainGuide = deferred(() => import("./brain/BrainGuide"));
const BrainFlows = deferred(() => import("./brain/BrainFlows"));
const WorkflowLibrary = deferred(() => import("../workflows/WorkflowLibrary"));
const WorkflowCanvas = deferred(() => import("../workflows/WorkflowCanvas"));
const WorkflowInspector = deferred(() => import("../workflows/WorkflowInspector"));
const DataLibrary = deferred(() => import("./data/DataLibrary"));
const DataWorkbench = deferred(() => import("./data/DataWorkbench"));
const DataInspector = deferred(() => import("./data/DataInspector"));

/**
 * The console's screens: each one fills the three panes (left · centre · right)
 * under the shared header. The header's switcher and the ☰ menu are built from
 * this list, so a new screen is one entry here (and its components).
 *
 *   id, path, label, icon
 *   switcher: shown in the header's switcher (false: reached some other way)
 *   tab: its place in the switcher (Chat first). The list's own order is
 *     how the screens' state nests (Workflows uses the brain's, so Agents comes
 *     before it here)
 *   left / center / right: { label, icon } of each pane, for the ☰ menu
 *   slots(ctx): { left?, center, right? }, the panes' content; a missing side
 *     pane keeps the console's own (Projects on the left, Bridge Spine on the right)
 *   Provider: state the screen keeps while another screen shows (see ScreenProviders.jsx)
 *   useBadge(): a count beside the switcher button (a hook, called on every render)
 *   feature: what your role must have switched on (access/features); off, the
 *     screen shows "No feature access" (and the switcher a lock)
 *   full: the screen's middle takes the whole width (no side panes; phones
 *     show only the screen tabs above it); "narrow": only on phones
 *
 * ctx comes from App: { intervalCenter, dashboardCenter, workspacesCenter, navigate }
 */
export const SCREENS = [
  {
    id: "interval",
    tab: 4,
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
  // Workspaces (the header's Workspaces button): a browser editor per project, with Projects and Bridges beside it
  {
    id: "workspaces",
    feature: "workspaces",
    path: "/workspaces",
    label: "Workspaces",
    icon: "💻",
    switcher: false,
    left: { label: "Projects", icon: "📂" },
    center: { label: "Workspaces", icon: "💻" },
    right: { label: "Bridges", icon: "🌉" },
    slots: (ctx) => ({ center: ctx.workspacesCenter }),
  },
  {
    id: "agents",
    tab: 3,
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
  // Workflows: draw them, keep templates, approve the brain's draft and watch it run (after Agents: it uses the brain's state)
  {
    id: "workflows",
    tab: 2,
    feature: "agents",
    path: "/workflows",
    label: "Workflows",
    icon: "⛓",
    switcher: true,
    left: { label: "Workflows", icon: "⛓" },
    center: { label: "Canvas", icon: "◇" },
    right: { label: "Inspector", icon: "☰" },
    Provider: WorkflowsProvider,
    slots: () => ({ left: <WorkflowLibrary />, center: <WorkflowCanvas />, right: <WorkflowInspector /> }),
  },
  // Datasets (continuum-data): only when the engine is switched on (VITE_DATA_ENABLED)
  ...(DATA_ENABLED
    ? [
        {
          id: "data",
          tab: 5,
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
  // Chat with the brain: a screen of its own (its state is the Agents screen's BrainProvider).
  // Wide screens: how the brain works on the left, sample flows on the right; phones: the chat alone
  {
    id: "chat",
    tab: 1,
    feature: "agents",
    path: "/chat",
    label: "Chat",
    icon: "💬",
    switcher: true,
    full: "narrow",
    left: { label: "How it works", icon: "✦" },
    center: { label: "Chat", icon: "💬" },
    right: { label: "Flows", icon: "⇉" },
    slots: () => ({ left: <BrainGuide />, center: <BrainChat />, right: <BrainFlows /> }),
  },
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
