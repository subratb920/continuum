// src/access/features.js
//
// What a role can switch on or off. Each feature opens part of Continuum;
// a role is the set of features switched on. Off: the screen says "No feature
// access" and the server refuses (403 NO_FEATURE_ACCESS). Admin opens the
// admin area; only users whose role has it (in the database) are admins.

export const FEATURES = [
  { id: "interval", label: "Interval Setup", description: "Projects, intervals and the Bridge Spine" },
  { id: "dashboard", label: "Dashboard", description: "Your own dashboard of projects and intervals" },
  { id: "agents", label: "Agents", description: "Your brain and its workers" },
  { id: "data", label: "Data", description: "Datasets" },
  { id: "workspaces", label: "Workspaces", description: "Development servers for your projects" },
  { id: "create", label: "Create project", description: "The New Project wizard" },
  { id: "import_github", label: "Import from GitHub", description: "Importing your GitHub repositories" },
  { id: "publish", label: "Put on GitHub", description: "Publishing a project to GitHub" },
  { id: "deploy", label: "Deploy", description: "Continuum Deploy" },
  { id: "admin", label: "Admin", description: "Users, roles and sign-ins" },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);

export const featureLabel = (id) => FEATURES.find((f) => f.id === id)?.label ?? id;
