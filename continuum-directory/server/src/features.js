// continuum-directory/server/src/features.js
//
// What a role can switch on or off, app by app: Continuum's own screens
// (the console) and each app joined to it (Brain agents, Data, Continuum
// Deploy). A role is the set of features switched on. Off: the screen says
// "No feature access" and the server refuses (403 NO_FEATURE_ACCESS).
//
// Each app has a feature that opens it (seeing what's there); the app's other
// features hang under it (parent) and count only while it is on. Admin opens
// the directory's admin area (users, roles, sign-ins); only users whose role
// has it are Continuum's admins. An organization's roles never give it.

export const APPS = [
  { id: "console", label: "Continuum Console", description: "Projects, intervals and the dashboard" },
  { id: "directory", label: "Continuum Directory", description: "Users, roles, organizations and departments (continuum-directory)" },
  { id: "create", label: "Continuum Create", description: "The New Project wizard, and projects to and from GitHub" },
  { id: "workspaces", label: "Continuum Workspaces", description: "Development servers for your projects (continuum-workspaces)" },
  { id: "agents", label: "Brain agents", description: "Your brain and its workers (continuum-brain)" },
  { id: "data", label: "Continuum Data", description: "Datasets, recipes and runs (continuum-data)" },
  { id: "deploy", label: "Continuum Deploy", description: "Deploying projects to Railway and Google Cloud" },
];

export const FEATURES = [
  // Continuum Console
  { id: "interval", app: "console", label: "Interval Setup", description: "Projects, intervals and the Bridge Spine" },
  { id: "dashboard", app: "console", label: "Dashboard", description: "Your own dashboard of projects and intervals" },

  // Continuum Directory (everyone opens it: their organizations; admin: Continuum's users, roles and sign-ins)
  { id: "directory", app: "directory", label: "Open Directory", description: "Your organizations, their members, departments and invites", since: 4, everyone: true },
  { id: "admin", app: "directory", label: "Admin", description: "Continuum's users, roles, sign-ins and production sync" },
  // Continuum Create (importing and publishing stand on their own: the wizard isn't needed for them)
  { id: "create", app: "create", label: "Open Create", description: "The New Project wizard: its catalogue and previews" },
  { id: "create_generate", app: "create", parent: "create", since: 3, label: "Make projects", description: "Generate a new project from the wizard" },
  { id: "import_github", app: "create", label: "Import from GitHub", description: "Importing your GitHub repositories" },
  { id: "publish", app: "create", label: "Put on GitHub", description: "Publishing a project to GitHub" },
  // Continuum Workspaces
  { id: "workspaces", app: "workspaces", label: "Open Workspaces", description: "See your development servers" },
  { id: "workspaces_create", app: "workspaces", parent: "workspaces", since: 3, label: "New workspaces", description: "Make a development server for a project" },
  { id: "workspaces_start", app: "workspaces", parent: "workspaces", since: 3, label: "Start and open", description: "Start a workspace and open it" },
  { id: "workspaces_manage", app: "workspaces", parent: "workspaces", since: 3, label: "Stop and delete", description: "Stop workspaces and delete them (with their files)" },
  // Brain agents
  { id: "agents", app: "agents", label: "Open Agents", description: "See the brain, its workers and what they did" },
  { id: "agents_run", app: "agents", parent: "agents", label: "Run agents", description: "Start agents, message the brain, answer their questions and approvals" },
  { id: "agents_push", app: "agents", parent: "agents", label: "Push changes", description: "Put an agent's changes on GitHub" },
  { id: "agents_manage", app: "agents", parent: "agents", label: "Stop and delete", description: "Stop agents and delete them" },
  { id: "agents_settings", app: "agents", parent: "agents", label: "Models and settings", description: "Change the brain's model and settings" },
  // Continuum Data
  { id: "data", app: "data", label: "Open Data", description: "See datasets, their versions and runs" },
  { id: "data_sources", app: "data", parent: "data", label: "Add data", description: "Add sources and upload files" },
  { id: "data_credentials", app: "data", parent: "data", label: "Saved logins", description: "Logins Data uses to read your sources" },
  { id: "data_recipes", app: "data", parent: "data", label: "Recipes and runs", description: "Make recipes and run them" },
  { id: "data_publish", app: "data", parent: "data", label: "Publish and export", description: "Publish versions and download exports" },
  // Continuum Deploy
  { id: "deploy", app: "deploy", label: "Open Continuum Deploy", description: "Sign in to Continuum Deploy and see deployments and their logs" },
  { id: "deploy_run", app: "deploy", parent: "deploy", label: "Deploy and run", description: "Deploy, start, stop, scale, roll back and run jobs" },
  { id: "deploy_settings", app: "deploy", parent: "deploy", label: "Apps and secrets", description: "Change apps, their settings, order and branch, and their secrets" },
  { id: "deploy_delete", app: "deploy", parent: "deploy", label: "Delete deployments", description: "Delete a deployment or one of its apps" },
  { id: "deploy_infra", app: "deploy", parent: "deploy", label: "Infrastructure", description: "Clusters, Cloud Run, domains and add-ons" },
  { id: "deploy_databases", app: "deploy", parent: "deploy", label: "Databases", description: "Database servers, imports, backups and restores" },
  { id: "deploy_connections", app: "deploy", parent: "deploy", label: "Cloud accounts", description: "Connect, check and disconnect Railway and Google Cloud" },
  { id: "deploy_annihilate", app: "deploy", parent: "deploy", label: "Annihilate", description: "Delete everything Continuum made through a connection, and housekeeping" },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);

/**
 * The feature set's version: roles saved before it gain the features added
 * since (each one its app's opening feature already gave), once.
 */
export const FEATURE_SET = 4;

/** Features every role gets once, when the feature set they were saved with is older (e.g. Open Directory). */
export const givenToEveryone = (before) => FEATURES.filter((f) => f.everyone && (f.since ?? 0) > before).map((f) => f.id);

/** Sub-features of each feature that opens an app (agents → agents_run…), optionally only those added after a feature set. */
export const childrenOf = (id, after = 0) => FEATURES.filter((f) => f.parent === id && (f.since ?? 2) > after).map((f) => f.id);

/** Only known features, each sub-feature only with its app's opening feature, in catalogue order. */
export function effectiveFeatures(list = []) {
  const on = new Set(list);
  return FEATURE_IDS.filter((id) => {
    if (!on.has(id)) return false;
    const parent = FEATURES.find((f) => f.id === id)?.parent;
    return !parent || on.has(parent);
  });
}

/** A feature's name in "No feature access" messages: an app's opening feature is the app itself. */
export const featureLabel = (id) => {
  const f = FEATURES.find((x) => x.id === id);
  if (!f) return id;
  return f.id === f.app ? (APPS.find((a) => a.id === f.app)?.label ?? f.label) : f.label;
};

/** Features of one app joined to Continuum (Continuum Deploy reads its own from the sign-in). */
export const featuresOfApp = (app, list) => list.filter((id) => FEATURES.find((f) => f.id === id)?.app === app);
