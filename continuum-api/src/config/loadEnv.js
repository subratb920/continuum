// src/config/loadEnv.js
//
// Loads environment variables once, before anything else. A value already set
// (by Docker Compose, by the cloud, or by an earlier file) is never overridden:
// 1. .env.local          — gitignored; secrets that must never be committed
// 2. .env.<NODE_ENV>      — committed: .env.development (local) or .env.production
//                          (the cloud); secrets appear there by name only
// 3. .env                — the existing local settings (not read in production)

import dotenv from "dotenv";

const mode = process.env.NODE_ENV || "development";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: `.env.${mode}`, quiet: true });
if (mode !== "production") dotenv.config({ quiet: true });
