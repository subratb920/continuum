// src/config/loadEnv.js
//
// Loads environment variables once, before anything else:
// 1. .env.local — gitignored; holds secrets that must never be committed
//    (for example the SSO signing key for continuum-deploy)
// 2. .env       — the existing settings
// Values already set (by Docker Compose, or by .env.local) are never overridden.

import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });
