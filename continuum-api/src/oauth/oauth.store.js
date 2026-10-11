// src/oauth/oauth.store.js
//
// Single-use authorization codes and rotating refresh tokens. Only SHA-256
// hashes are stored; expired documents are removed by TTL indexes.

import { randomToken, sha256 } from "./oauth.crypto.js";

export const CODES = "oauth_codes";
export const REFRESH_TOKENS = "oauth_refresh_tokens";

export function createOAuthStore(db) {
  const codes = db.collection(CODES);
  const refresh = db.collection(REFRESH_TOKENS);

  async function createCode({ userId, clientId, redirectUri, codeChallenge, ttlSeconds }) {
    const code = randomToken();
    await codes.insertOne({
      _id: sha256(code),
      userId,
      clientId,
      redirectUri,
      codeChallenge,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      usedAt: null,
      familyId: null,
    });
    return code;
  }

  /**
   * Marks the code used in one atomic step. A second use is refused and the
   * tokens issued from the first use are revoked (spec 6.7).
   */
  async function consumeCode(code) {
    const id = sha256(code);
    const doc = await codes.findOneAndUpdate(
      { _id: id, usedAt: null },
      { $set: { usedAt: new Date() } },
      { returnDocument: "before" }
    );
    if (doc) return { ok: true, doc };

    const used = await codes.findOne({ _id: id });
    if (used?.familyId) await revokeFamily(used.familyId);
    return { ok: false, reused: Boolean(used) };
  }

  async function linkCodeToFamily(code, familyId) {
    await codes.updateOne({ _id: sha256(code) }, { $set: { familyId } });
  }

  async function issueRefreshToken({ userId, clientId, familyId, ttlSeconds }) {
    const token = randomToken();
    await refresh.insertOne({
      _id: sha256(token),
      familyId,
      userId,
      clientId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      usedAt: null,
      revokedAt: null,
    });
    return token;
  }

  /**
   * Uses a refresh token once. Reusing an already rotated token means it was
   * copied: the whole chain is revoked and the user is signed out (spec 6.3).
   */
  async function rotateRefreshToken(token) {
    const id = sha256(token);
    const doc = await refresh.findOneAndUpdate(
      { _id: id, usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { returnDocument: "before" }
    );
    if (doc) return { ok: true, doc };

    const known = await refresh.findOne({ _id: id });
    if (known && known.usedAt) {
      await revokeFamily(known.familyId);
      return { ok: false, reused: true };
    }
    return { ok: false, reused: false };
  }

  async function revokeFamily(familyId) {
    await refresh.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  async function revokeByToken(token) {
    const known = await refresh.findOne({ _id: sha256(token) });
    if (known) await revokeFamily(known.familyId);
  }

  async function revokeAllForUser(userId) {
    const res = await refresh.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return res.modifiedCount;
  }

  return {
    createCode,
    consumeCode,
    linkCodeToFamily,
    issueRefreshToken,
    rotateRefreshToken,
    revokeByToken,
    revokeAllForUser,
  };
}
