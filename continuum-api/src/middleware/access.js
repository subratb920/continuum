// src/middleware/access.js
//
// After requireAuth: the signed-in user's access (role and features) on
// req.access, and the checks that refuse what their role has switched off.

import { getDB } from "../config/db.js";
import { accessFor } from "../access/access.js";
import { createUsageTracker } from "../access/activity.js";
import { featureLabel } from "../access/features.js";
import { requireAuth } from "./requireAuth.js";

/** App use and last seen, written once a minute (access/activity.js). */
export const usage = createUsageTracker(() => getDB());

/** Counts this request as use of an app (a feature), for the admin's view. */
export const uses = (app) => (req, _res, next) => {
  usage.used(req.user?.id, app);
  next();
};

/** Loads req.access; a disabled or deleted account gets nothing. */
export function withAccess(opts = {}) {
  const db = opts.db ?? (() => getDB());
  return async (req, res, next) => {
    try {
      const access = await accessFor(db(), req.user.id, opts);
      if (!access) return res.status(401).json({ error: "This account no longer exists.", code: "NO_ACCOUNT" });
      if (access.disabled) return res.status(403).json({ error: "This account is disabled. Ask your admin.", code: "ACCOUNT_DISABLED" });
      req.access = access;
      if (!opts.db) usage.sawUser(req.user.id); // last seen (not in tests with their own database)
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Signed in, with access loaded: what every signed-in route needs. */
export const authed = [requireAuth, withAccess()];

const refuse = (res, feature) =>
  res.status(403).json({
    error: `No feature access: ${featureLabel(feature)} isn't switched on for your role. Ask your admin.`,
    code: "NO_FEATURE_ACCESS",
    feature,
  });

/** Lets the request through when the user's role has any of these features. */
export function requireFeature(...features) {
  return (req, res, next) => (features.some((f) => req.access?.features.includes(f)) ? next() : refuse(res, features[0]));
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reading needs any of `read`, changing anything needs any of `write`. */
export function requireFeatureByMethod({ read, write }) {
  return (req, res, next) => {
    const need = READS.has(req.method) ? read : write;
    return need.some((f) => req.access?.features.includes(f)) ? next() : refuse(res, need[0]);
  };
}
