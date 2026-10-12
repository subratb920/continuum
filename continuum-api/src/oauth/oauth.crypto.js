// src/oauth/oauth.crypto.js
//
// Small, self-contained crypto helpers for the SSO between Continuum and
// continuum-deploy (Phase 1 spec, Section 6). Built on Node's crypto module only.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from "crypto";

export function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** Random, URL-safe secret (codes, refresh tokens). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Only hashes of codes and refresh tokens are stored. */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// RFC 7636: verifier is 43-128 characters from the unreserved set
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidChallenge(challenge) {
  return typeof challenge === "string" && CHALLENGE.test(challenge);
}

/** PKCE S256: base64url(SHA-256(verifier)) must equal the challenge. */
export function verifyPkce(verifier, challenge) {
  if (typeof verifier !== "string" || !VERIFIER.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(computed, challenge);
}

/** Loads the Ed25519 private key from a base64-encoded PEM (the .env value). */
export function loadSigningKey(base64Pem) {
  const key = createPrivateKey(Buffer.from(base64Pem, "base64").toString("utf8"));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("OAUTH_SIGNING_KEY must be an Ed25519 private key");
  }
  return key;
}

/** Public key in JWK form, for GET /oauth/jwks. */
export function publicJwk(privateKey, kid) {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  return { ...jwk, kid, alg: "EdDSA", use: "sig" };
}

/** Signs a JWT with EdDSA (Ed25519). */
export function signJwt(payload, privateKey, kid) {
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign(null, Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

/**
 * Checks a JWT this server signed: EdDSA signature with our key, issuer,
 * audience and expiry. Returns the claims, or null if anything is wrong.
 */
export function verifyJwt(token, privateKey, { issuer, audience }, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "EdDSA") return null;
    const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(privateKey), Buffer.from(parts[2], "base64url"));
    if (!ok) return null;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.iss !== issuer || claims.aud !== audience) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
    if (typeof claims.sub !== "string" || !claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}
