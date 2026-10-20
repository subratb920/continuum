// src/oauth/oauth.config.js
//
// Single sign-on for Continuum's apps on their own addresses, each an OAuth
// client of this API:
//   continuum-deploy        Continuum Deploy's server (confidential: a client
//                           secret, OAUTH_CLIENT_SECRET_HASH); only when that's set
//   continuum-directory     the Directory's page (continuum-directory-app) in the
//                           browser (public: PKCE only, no secret)
// Optional: without OAUTH_SIGNING_KEY, Continuum runs as before and the /oauth
// endpoints answer 503 "SSO not configured".

import { loadSigningKey } from "./oauth.crypto.js";

let cached;

const list = (v) =>
  String(v || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

export function getOAuthConfig() {
  if (cached !== undefined) return cached;

  const signingKey = process.env.OAUTH_SIGNING_KEY;
  if (!signingKey) {
    cached = null;
    return cached;
  }

  const clientSecretHash = process.env.OAUTH_CLIENT_SECRET_HASH || null;
  const deploy = clientSecretHash
    ? {
        clientId: process.env.OAUTH_CLIENT_ID || "continuum-deploy",
        public: false,
        clientSecretHash,
        audience: "continuum-deploy",
        // Signing in to it needs this feature; its token carries this app's features
        feature: "deploy",
        app: "deploy",
        method: "deploy",
        // Exact strings; compared character for character (spec 6.3)
        redirectUris: list(process.env.OAUTH_REDIRECT_URIS),
      }
    : null;
  const directoryApp = String(process.env.DIRECTORY_APP_URL || "").replace(/\/+$/, "");
  const directory = {
    clientId: "continuum-directory",
    public: true,
    audience: "continuum-directory",
    feature: "directory",
    app: "directory",
    method: "directory",
    redirectUris: list(process.env.DIRECTORY_REDIRECT_URIS || (directoryApp ? `${directoryApp}/callback` : "")),
  };

  cached = {
    issuer: process.env.OAUTH_ISSUER || "continuum-api",
    keyId: process.env.OAUTH_KEY_ID || "continuum-1",
    privateKey: loadSigningKey(signingKey),
    clients: Object.fromEntries([deploy, directory].filter(Boolean).map((c) => [c.clientId, c])),
    // Continuum Deploy's (as before: its token checks and Production sync use these)
    ...(deploy ? { clientId: deploy.clientId, clientSecretHash, audience: deploy.audience, redirectUris: deploy.redirectUris } : { audience: "continuum-deploy" }),
    codeTtlSeconds: 60,
    accessTtlSeconds: 10 * 60,
    refreshTtlSeconds: 12 * 60 * 60,
  };
  return cached;
}

/** Forget the settings (tests that change them). */
export function resetOAuthConfig() {
  cached = undefined;
}
