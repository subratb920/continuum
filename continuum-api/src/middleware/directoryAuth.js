// src/middleware/directoryAuth.js
//
// Who's calling /directory: Continuum's own sign-in token (the Continuum UI:
// the space switcher), or a Directory sign-in token (the Directory's page,
// continuum-directory-app, signed in through Continuum: audience
// continuum-directory). A Directory token opens /directory only.

import { ObjectId } from "mongodb";
import { verifyToken } from "../utils/jwt.js";
import { getOAuthConfig } from "../oauth/oauth.config.js";
import { verifyJwt } from "../oauth/oauth.crypto.js";

export function requireAuthOrDirectoryToken(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = verifyToken(token);
    req.user = { id: typeof payload.userId === "string" ? new ObjectId(payload.userId) : payload.userId, tv: payload.tv ?? 0 };
    return next();
  } catch {
    // not Continuum's own: a Directory token?
  }

  const cfg = getOAuthConfig();
  const client = cfg?.clients["continuum-directory"];
  const claims = client ? verifyJwt(token, cfg.privateKey, { issuer: cfg.issuer, audience: client.audience }) : null;
  if (!claims || !ObjectId.isValid(String(claims.sub)) || !/^[a-f0-9]{24}$/.test(String(claims.sub))) return res.status(401).json({ error: "Invalid token" });
  // tv: their session version when it was made (withAccess refuses it after "sign out everywhere")
  req.user = { id: new ObjectId(claims.sub), tv: claims.tv ?? 0, via: "directory" };
  next();
}
