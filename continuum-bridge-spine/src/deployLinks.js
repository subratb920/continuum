// Links into Continuum Deploy. Opening one signs the user in via Continuum (SSO)
// and lands on the page given by returnTo.

// Continuum Deploy's sign-in address (VITE_DEPLOY_LOGIN_URL), e.g.
// http://localhost:45180/auth/login?from=continuum. Unset: no Deploy menu.
const DEPLOY_LOGIN_URL = import.meta.env.VITE_DEPLOY_LOGIN_URL || "";

/** Whether this setup links to a Continuum Deploy. */
export const DEPLOY_AVAILABLE = Boolean(DEPLOY_LOGIN_URL);

function withReturn(path) {
  const url = new URL(DEPLOY_LOGIN_URL);
  url.searchParams.set("returnTo", path);
  return url.toString();
}

/** The start screen: what Continuum Deploy does, and a card for every cloud. */
export function deployHomeUrl() {
  return withReturn("/");
}

/** A cloud Continuum Deploy doesn't support yet: its own page there, which says so ("azure", "vercel" …). */
export function deployCloudPageUrl(cloud) {
  return withReturn(`/clouds/${encodeURIComponent(cloud)}`);
}

/** Connections page: all clouds (cloud null), or only one ("aws", "railway"). */
export function deployConnectionsUrl(cloud) {
  return withReturn(`/connections?cloud=${cloud || "all"}`);
}

/** Deployments list, for one cloud ("railway") or all. */
export function deployListUrl(cloud) {
  return withReturn(`/deployments?cloud=${cloud || "all"}`);
}

/**
 * Deploy this Continuum project on a cloud: Continuum Deploy opens with the
 * project chosen (its app's page if it has one, otherwise a new app for its repo).
 */
export function deployProjectUrl(projectId, cloud) {
  return withReturn(`/deployments/new?project=${encodeURIComponent(projectId)}&cloud=${cloud || "all"}`);
}
