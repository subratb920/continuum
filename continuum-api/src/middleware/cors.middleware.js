import cors from "cors";
import { ENV } from "../config/env.js";

/**
 * CORS middleware for Continuum API.
 * Infrastructure-only. No business logic.
 */
export function corsMiddleware() {
  return cors({
    // Continuum's page, and the Directory's (continuum-directory-app, DIRECTORY_APP_URL)
    origin: [ENV.CLIENT_ORIGIN, process.env.DIRECTORY_APP_URL].filter(Boolean).map((o) => o.replace(/\/+$/, "")),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // PUT: /brain/settings (your models)
  });
}
