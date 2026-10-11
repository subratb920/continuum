// Unit tests for the SSO crypto helpers (no database needed).
// Run: npm test   (inside continuum-api)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import {
  isValidChallenge,
  loadSigningKey,
  publicJwk,
  randomToken,
  safeEqual,
  sha256,
  signJwt,
  verifyPkce,
} from "../src/oauth/oauth.crypto.js";

const verifier = randomToken(32); // 43 characters, as continuum-deploy sends
const challenge = createHash("sha256").update(verifier).digest("base64url");

test("PKCE S256 accepts the matching verifier only", () => {
  assert.equal(isValidChallenge(challenge), true);
  assert.equal(verifyPkce(verifier, challenge), true);
  assert.equal(verifyPkce(randomToken(32), challenge), false);
  assert.equal(verifyPkce("short", challenge), false);
  assert.equal(verifyPkce(undefined, challenge), false);
});

test("a 'plain' challenge (the verifier itself) is not a valid S256 challenge", () => {
  assert.equal(isValidChallenge(verifier + "x"), false);
  assert.equal(verifyPkce(verifier, verifier), false);
});

test("constant-time comparison", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("hashes are stable and never equal the input", () => {
  assert.equal(sha256("x"), sha256("x"));
  assert.notEqual(sha256("x"), "x");
});

test("Ed25519 JWT: signature verifies with the published key; tampering breaks it", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  const key = loadSigningKey(Buffer.from(pem).toString("base64"));

  const token = signJwt({ sub: "u1", aud: "continuum-deploy" }, key, "k1");
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "EdDSA", typ: "JWT", kid: "k1" });

  const jwk = publicJwk(key, "k1");
  assert.equal(jwk.kty, "OKP");
  assert.equal(jwk.crv, "Ed25519");
  assert.equal(jwk.d, undefined, "the private part is never published");

  const pub = { key: jwk, format: "jwk" };
  assert.equal(verify(null, Buffer.from(`${h}.${p}`), pub, Buffer.from(s, "base64url")), true);
  const forged = Buffer.from(JSON.stringify({ sub: "attacker", aud: "continuum-deploy" })).toString("base64url");
  assert.equal(verify(null, Buffer.from(`${h}.${forged}`), pub, Buffer.from(s, "base64url")), false);
});

test("only Ed25519 keys are accepted for signing", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  assert.throws(() => loadSigningKey(Buffer.from(pem).toString("base64")), /Ed25519/);
});
