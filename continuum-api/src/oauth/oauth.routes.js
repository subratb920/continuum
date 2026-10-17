// src/oauth/oauth.routes.js
//
// SSO for continuum-deploy: OAuth 2.0 authorization code + PKCE (RFC 6749,
// RFC 7636), built in-house (Phase 1 spec, Section 6).
//
//   POST /oauth/authorize   Continuum UI, signed-in user  -> single-use code
//   POST /oauth/token       continuum-deploy-api (client) -> access + refresh token
//   POST /oauth/revoke      continuum-deploy-api (client) -> revoke a token chain
//   POST /oauth/revoke-all  Continuum UI on sign-out      -> revoke all of the user's chains
//   GET  /oauth/jwks        public signing keys

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { authed, requireFeature } from "../middleware/access.js";
import { accessFor } from "../access/access.js";
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

/** Client authentication for server-to-server calls (constant-time secret check). */
function clientIsValid(cfg, body) {
  const idOk = safeEqual(body.client_id ?? "", cfg.clientId);
  const secretOk = safeEqual(sha256(String(body.client_secret ?? "")), cfg.clientSecretHash);
  return idOk && secretOk;
}

async function issueTokens(cfg, store, user, familyId) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt(
    {
      iss: cfg.issuer,
      aud: cfg.audience,
      sub: String(user._id),
      email: user.email,
      tenant: `u:${user._id}`,
      iat: now,
      exp: now + cfg.accessTtlSeconds,
      jti: randomToken(16),
    },
    cfg.privateKey,
    cfg.keyId
  );
  const refreshToken = await store.issueRefreshToken({
    userId: user._id,
    clientId: cfg.clientId,
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
// Signing in to Deploy needs the deploy feature (and an account that isn't disabled)
router.post("/authorize", requireConfig, authed, requireFeature("deploy"), async (req, res) => {
  const cfg = req.oauth;
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.body ?? {};

  // Nothing is redirected until client and return address are verified
  if (client_id !== cfg.clientId) return oauthError(res, 400, "unauthorized_client", "Unknown application.");
  if (!cfg.redirectUris.includes(redirect_uri)) return oauthError(res, 400, "invalid_request", "Return address is not registered.");
  if (code_challenge_method !== "S256" || !isValidChallenge(code_challenge)) {
    return oauthError(res, 400, "invalid_request", "PKCE with S256 is required.");
  }
  if (typeof state !== "string" || state.length < 16 || state.length > 256) {
    return oauthError(res, 400, "invalid_request", "A state value is required.");
  }

  const store = createOAuthStore(getDB());
  const code = await store.createCode({
    userId: req.user.id,
    clientId: cfg.clientId,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    ttlSeconds: cfg.codeTtlSeconds,
  });

  req.log.info({ userId: req.user.id, clientId: cfg.clientId }, "SSO code issued");

  const target = new URL(redirect_uri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  res.json({ redirectTo: target.toString() });
});

// --- Token: server-to-server from continuum-deploy-api ---------------------------
/** May this user use Continuum Deploy now (deploy feature on, account not disabled)? */
async function deployAllowed(db, userId) {
  const access = await accessFor(db, userId);
  return !!access && !access.disabled && access.features.includes("deploy");
}

router.post("/token", requireConfig, async (req, res) => {
  const cfg = req.oauth;
  const body = req.body ?? {};
  if (!clientIsValid(cfg, body)) return oauthError(res, 401, "invalid_client", "Client authentication failed.");

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
    if (doc.clientId !== cfg.clientId || doc.redirectUri !== redirect_uri) {
      return oauthError(res, 400, "invalid_grant", "Code was issued for another application or address.");
    }
    if (!verifyPkce(code_verifier, doc.codeChallenge)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");

    const user = await users.findOne({ _id: new ObjectId(String(doc.userId)) });
    if (!user) return oauthError(res, 400, "invalid_grant", "User no longer exists.");
    if (!(await deployAllowed(db, user._id))) return oauthError(res, 400, "invalid_grant", "No feature access: Deploy isn't switched on for this account's role.");

    const familyId = randomToken(16);
    await store.linkCodeToFamily(code, familyId);
    req.log.info({ userId: String(user._id) }, "SSO tokens issued");
    return res.json(await issueTokens(cfg, store, user, familyId));
  }

  if (body.grant_type === "refresh_token") {
    if (typeof body.refresh_token !== "string") return oauthError(res, 400, "invalid_grant", "Refresh token missing.");
    const result = await store.rotateRefreshToken(body.refresh_token);
    if (!result.ok) {
      if (result.reused) req.log.warn("SSO refresh token reused: chain revoked");
      return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired or revoked.");
    }
    const user = await users.findOne({ _id: new ObjectId(String(result.doc.userId)) });
    if (!user) return oauthError(res, 400, "invalid_grant", "User no longer exists.");
    // Deploy switched off (or the account disabled) since: no more tokens, so Deploy signs out
    if (!(await deployAllowed(db, user._id))) return oauthError(res, 400, "invalid_grant", "No feature access: Deploy isn't switched on for this account's role.");
    return res.json(await issueTokens(cfg, store, user, result.doc.familyId));
  }

  return oauthError(res, 400, "unsupported_grant_type", "Unsupported grant type.");
});

// --- Revoke: continuum-deploy sign-out -------------------------------------------
router.post("/revoke", requireConfig, async (req, res) => {
  const cfg = req.oauth;
  const body = req.body ?? {};
  if (!clientIsValid(cfg, body)) return oauthError(res, 401, "invalid_client", "Client authentication failed.");
  if (typeof body.token === "string") await createOAuthStore(getDB()).revokeByToken(body.token);
  res.status(200).json({ revoked: true });
});

// --- Revoke all: Continuum sign-out ends continuum-deploy sessions too ------------
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
