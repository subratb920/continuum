import cors from "cors";
import { ENV } from "../config/env.js";

/**
 * CORS middleware for Continuum API.
 * Infrastructure-only. No business logic.
 */
export function corsMiddleware() {
  return cors({
    origin: ENV.CLIENT_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // PUT: /brain/settings (your models)
  });
}
