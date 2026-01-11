import { ENV } from "../config/env.js";

export const AUDIT_CONFIG = {
  enabled: ENV.AUDIT_LOGGING === "true",

  // collection prefix → audit_2026_01
  collectionPrefix: "audit",

  // retention (months)
  retentionMonths: 12,
};
