// src/oauth/oauth.routes.js
//
// SSO for Continuum's apps on their own addresses: OAuth 2.0 authorization
// code + PKCE (RFC 6749, RFC 7636), built in-house (Phase 1 spec, Section 6).
// Clients (oauth.config.js): continuum-deploy (its server, with a secret) and
// continuum-directory (the Directory's page in the browser: public, PKCE only).
//
//   POST /oauth/authorize   Continuum UI, signed-in user  -> single-use code
//   POST /oauth/token       the client                    -> access + refresh token
//   POST /oauth/revoke      the client                    -> revoke a token chain
//   POST /oauth/revoke-all  Continuum UI on sign-out      -> revoke all of the user's chains
//   GET  /oauth/jwks        public signing keys

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { authed } from "../middleware/access.js";
import { usage } from "../middleware/access.js";
import { dir, features as catalogue } from "../directory/directory.js";
import { getOAuthConfig } from "./oauth.config.js";
import { isValidChallenge, publicJwk, randomToken, safeEqual, sha256, signJwt, verifyPkce } from "./oauth.crypto.js";
import { createOAuthStore } from "./oauth.store.js";

const router = express.Router();

// Tokens must never be cached by browsers or proxies
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function oauthError(res, status, error, description) {
  return res.status(status).json({ error, error_description: description });
}

function requireConfig(req, res, next) {
  const cfg = getOAuthConfig();
  if (!cfg) return oauthError(res, 503, "temporarily_unavailable", "SSO is not configured on this server.");
  req.oauth = cfg;
  next();
}

/**
 * The calling client: a confidential one proves itself with its secret
 * (constant-time check); a public one (the Directory's page) only names
 * itself, and PKCE stands for the secret. null: unknown or wrong secret.
 */
function clientOf(cfg, body) {
  const client = cfg.clients[String(body.client_id ?? "")];
  if (!client) return null;
  if (client.public) return client;
  const idOk = safeEqual(body.client_id ?? "", client.clientId);
  const secretOk = safeEqual(sha256(String(body.client_secret ?? "")), client.clientSecretHash);
  return idOk && secretOk ? client : null;
}

async function issueTokens(cfg, client, store, user, familyId, { features = [], tv = 0 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt(
    {
      iss: cfg.issuer,
      aud: client.audience,
      sub: String(user._id),
      email: user.email,
      tenant: `u:${user._id}`,
      // What this person may do in that app (their role's features for it, as of now)
      features,
      // Their session version: signing out everywhere ends this token too
      tv,
      iat: now,
      exp: now + cfg.accessTtlSeconds,
      jti: randomToken(16),
    },
    cfg.privateKey,
    cfg.keyId
  );
  const refreshToken = await store.issueRefreshToken({
    userId: user._id,
    clientId: client.clientId,
    familyId,
    ttlSeconds: cfg.refreshTtlSeconds,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: cfg.accessTtlSeconds,
    refresh_token: refreshToken,
  };
}

// --- Authorize: called by the Continuum UI page /sso/authorize -------------------
// Signing in to an app needs its feature (deploy, directory) and an account that isn't disabled
router.post("/authorize", requireConfig, authed, async (req, res) => {
  const cfg = req.oauth;
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.body ?? {};

  // Nothing is redirected until client and return address are verified
  const client = cfg.clients[String(client_id ?? "")];
  if (!client) return oauthError(res, 400, "unauthorized_client", "Unknown application.");
  if (!client.redirectUris.includes(redirect_uri)) return oauthError(res, 400, "invalid_request", "Return address is not registered.");
  if (!req.access.features.includes(client.feature)) {
    return res.status(403).json({ error: `No feature access: ${catalogue.featureLabel(client.feature)} isn't switched on for your role. Ask your admin.`, code: "NO_FEATURE_ACCESS", feature: client.feature });
  }
  if (code_challenge_method !== "S256" || !isValidChallenge(code_challenge)) {
    return oauthError(res, 400, "invalid_request", "PKCE with S256 is required.");
  }
  if (typeof state !== "string" || state.length < 16 || state.length > 256) {
    return oauthError(res, 400, "invalid_request", "A state value is required.");
  }

  const store = createOAuthStore(getDB());
  const code = await store.createCode({
    userId: req.user.id,
    clientId: client.clientId,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    ttlSeconds: cfg.codeTtlSeconds,
  });

  req.log.info({ userId: req.user.id, clientId: client.clientId }, "SSO code issued");
  // Signing in to the app, from this browser (the token exchange that follows comes from the app)
  await dir.recordLogin({ userId: req.user.id, email: req.access.email, method: client.method, req }).catch(() => {});
  usage.used(req.user.id, client.app);

  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  res.json({ redirectTo: target.toString() });
});

// --- Token: from the client (Deploy's server; the Directory's page) --------------
/**
 * The person's features in the client's app and their session version, or
 * null when they may not use it (its feature off, or the account disabled).
 */
async function appAccess(client, userId) {
  const access = await dir.accessFor(String(userId));
  if (!access || access.disabled || !access.features.includes(client.feature)) return null;
  return { features: catalogue.featuresOfApp(client.app, access.features), tv: access.tokenVersion };
}

router.post("/token", requireConfig, async (req, res) => {
  const cfg = req.oauth;
  const body = req.body ?? {};
  const client = clientOf(cfg, body);
  if (!client) return oauthError(res, 401, "invalid_client", "Client authentication failed.");

  const db = getDB();
  const store = createOAuthStore(db);
  const users = db.collection("users");

  if (body.grant_type === "authorization_code") {
    const { code, code_verifier, redirect_uri } = body;
    if (typeof code !== "string") return oauthError(res, 400, "invalid_grant", "Code missing.");

    const result = await store.consumeCode(code);
    if (!result.ok) {
      req.log.warn({ reused: result.reused }, "SSO code refused");
      return oauthError(res, 400, "invalid_grant", "Code is invalid, expired or already used.");
    }
    const doc = result.doc;
    if (doc.expiresAt <= new Date()) return oauthError(res, 400, "invalid_grant", "Code expired.");
    if (doc.clientId !== client.clientId || doc.redirectUri !== redirect_uri) {
      return oauthError(res, 400, "invalid_grant", "Code was issued for another application or address.");
    }
    if (!verifyPkce(code_verifier, doc.codeChallenge)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");

    const user = await users.findOne({ _id: new ObjectId(String(doc.userId)) });
    if (!user) return oauthError(res, 400, "invalid_grant", "User no longer exists.");
    const allowed = await appAccess(client, user._id);
    if (!allowed) return oauthError(res, 400, "invalid_grant", `No feature access: ${catalogue.featureLabel(client.feature)} isn't switched on for this account's role.`);

    const familyId = randomToken(16);
    await store.linkCodeToFamily(code, familyId);
    req.log.info({ userId: String(user._id), clientId: client.clientId }, "SSO tokens issued");
    return res.json(await issueTokens(cfg, client, store, user, familyId, allowed));
  }

  if (body.grant_type === "refresh_token") {
    if (typeof body.refresh_token !== "string") return oauthError(res, 400, "invalid_grant", "Refresh token missing.");
    const result = await store.rotateRefreshToken(body.refresh_token);
    if (!result.ok) {
      if (result.reused) req.log.warn("SSO refresh token reused: chain revoked");
      return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired or revoked.");
    }
    // A refresh token is only ever its own client's
    if (result.doc.clientId && result.doc.clientId !== client.clientId) return oauthError(res, 400, "invalid_grant", "Refresh token was issued for another application.");
    const user = await users.findOne({ _id: new ObjectId(String(result.doc.userId)) });
    if (!user) return oauthError(res, 400, "invalid_grant", "User no longer exists.");
    // The app switched off (or the account disabled) since: no more tokens, so the app signs out
    const allowed = await appAccess(client, user._id);
    if (!allowed) return oauthError(res, 400, "invalid_grant", `No feature access: ${catalogue.featureLabel(client.feature)} isn't switched on for this account's role.`);
    usage.used(user._id, client.app); // still using the app
    // A role changed since: the new features ride on the new token (within the access token's lifetime)
    return res.json(await issueTokens(cfg, client, store, user, result.doc.familyId, allowed));
  }

  return oauthError(res, 400, "unsupported_grant_type", "Unsupported grant type.");
});

// --- Revoke: an app's sign-out ---------------------------------------------------
router.post("/revoke", requireConfig, async (req, res) => {
  const cfg = req.oauth;
  const body = req.body ?? {};
  if (!clientOf(cfg, body)) return oauthError(res, 401, "invalid_client", "Client authentication failed.");
  if (typeof body.token === "string") await createOAuthStore(getDB()).revokeByToken(body.token);
  res.status(200).json({ revoked: true });
});

// --- Revoke all: Continuum sign-out ends the apps' sessions too ------------------
// Signing out always works (a disabled account too)
router.post("/revoke-all", requireConfig, requireAuth, async (req, res) => {
  const count = await createOAuthStore(getDB()).revokeAllForUser(req.user.id);
  req.log.info({ userId: req.user.id, revoked: count }, "SSO sessions revoked at sign-out");
  res.json({ revoked: count });
});

// --- Public keys -----------------------------------------------------------------
router.get("/jwks", requireConfig, (req, res) => {
  res.json({ keys: [publicJwk(req.oauth.privateKey, req.oauth.keyId)] });
});

export default router;
