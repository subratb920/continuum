import cors from "cors";
import { ENV } from "../config/env.js";

/**
 * CORS middleware for Continuum API.
 * Infrastructure-only. No business logic.
 */
export function corsMiddleware() {
  // The public website's origins (continuum-site) for its /public beacon and lead form
  const publicSites = (process.env.PUBLIC_SITE_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  return cors({
    // Continuum's page, the Directory's (continuum-directory-app, DIRECTORY_APP_URL), and the public site
    origin: [ENV.CLIENT_ORIGIN, process.env.DIRECTORY_APP_URL, ...publicSites].filter(Boolean).map((o) => o.replace(/\/+$/, "")),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // PUT: /brain/settings (your models)
  });
}
