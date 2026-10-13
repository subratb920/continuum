// src/config/urls.js
//
// Addresses that differ between running locally and in the cloud, from the
// environment (never written into the code).

/**
 * Where people land in the UI after signing in, with their session token:
 * CLIENT_AUTH_CALLBACK_URL, else <CLIENT_ORIGIN>/auth/callback.
 */
export function clientAuthCallbackUrl(token) {
  const base = process.env.CLIENT_AUTH_CALLBACK_URL || `${String(process.env.CLIENT_ORIGIN || "").replace(/\/+$/, "")}/auth/callback`;
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * The address GitHub sends people back to (GITHUB_CALLBACK_URL). It must be
 * the callback URL registered on the GitHub OAuth app. Unset: GitHub uses the
 * app's registered one.
 */
export function githubCallbackUrl() {
  return process.env.GITHUB_CALLBACK_URL || null;
}

/** GitHub's sign-in page for this app (client ID, scopes and, if set, the callback). */
export function githubAuthorizeUrl(scope) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID || "");
  url.searchParams.set("scope", scope);
  const callback = githubCallbackUrl();
  if (callback) url.searchParams.set("redirect_uri", callback);
  return url.toString();
}
