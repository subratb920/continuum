// src/access/rules.js
//
// Which of an app's features each request needs (requireFeatureFor), beyond
// the feature that opens the app. Paths are relative to where the app is
// mounted (/brain, /data, /create, /workspaces). The first matching rule wins.

/** Brain agents (/brain, relayed to continuum-brain). */
export const AGENTS_RULES = [
  ["POST", /^\/agents\/[^/]+\/push$/, "agents_push"],
  ["POST", /^\/agents\/[^/]+\/stop$/, "agents_manage"],
  ["DELETE", /^\/agents\/[^/]+$/, "agents_manage"],
  ["POST", /^\/agents$/, "agents_run"],
  ["POST", /^\/agents\/[^/]+\/reply$/, "agents_run"],
  ["POST", /^\/core\/messages$/, "agents_run"],
  ["PUT", /^\/settings$/, "agents_settings"],
];

/** Continuum Data (/data). */
export const DATA_RULES = [
  ["*", /^\/credentials(\/|$)/, "data_credentials"],
  ["*", /^\/versions\/[^/]+\/(publish|exports)(\/|$)/, "data_publish"],
  ["write", /^\/(sources|uploads|datasets)(\/|$)/, "data_sources"],
  ["write", /^\/(recipes|runs)(\/|$)/, "data_recipes"],
];

/** Continuum Create (/create): making a project; the catalogue and previews need only Create. */
export const CREATE_RULES = [["POST", /^\/generate$/, "create_generate"]];

/** Continuum Workspaces (/workspaces). */
export const WORKSPACES_RULES = [
  ["POST", /^\/$/, "workspaces_create"],
  ["POST", /^\/[^/]+\/open$/, "workspaces_start"],
  ["POST", /^\/[^/]+\/stop$/, "workspaces_manage"],
  ["DELETE", /^\/[^/]+$/, "workspaces_manage"],
];
