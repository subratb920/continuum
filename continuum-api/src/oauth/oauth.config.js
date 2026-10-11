// src/oauth/oauth.config.js
//
// SSO settings for continuum-deploy. Optional: if they are not set, Continuum
// runs exactly as before and the /oauth endpoints answer 503 "SSO not configured".

import { loadSigningKey } from "./oauth.crypto.js";

let cached;

export function getOAuthConfig() {
  if (cached !== undefined) return cached;

  const signingKey = process.env.OAUTH_SIGNING_KEY;
  const clientSecretHash = process.env.OAUTH_CLIENT_SECRET_HASH;

  if (!signingKey || !clientSecretHash) {
    cached = null;
    return cached;
  }

  cached = {
    issuer: process.env.OAUTH_ISSUER || "continuum-api",
    audience: "continuum-deploy",
    keyId: process.env.OAUTH_KEY_ID || "continuum-1",
    privateKey: loadSigningKey(signingKey),
    clientId: process.env.OAUTH_CLIENT_ID || "continuum-deploy",
    clientSecretHash,
    // Exact strings; compared character for character (spec 6.3)
    redirectUris: (process.env.OAUTH_REDIRECT_URIS || "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    codeTtlSeconds: 60,
    accessTtlSeconds: 10 * 60,
    refreshTtlSeconds: 12 * 60 * 60,
  };
  return cached;
}
