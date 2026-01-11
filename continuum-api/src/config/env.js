// src/config/env.js

/**
 * Read and validate required environment variables.
 * The application is strict by design:
 * missing config = startup failure.
 */

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }

  return value;
}

export const ENV = {
  // --- Runtime environment ---
  NODE_ENV: requireEnv("NODE_ENV"),          // development | production
  LOG_LEVEL: requireEnv("LOG_LEVEL"),        // trace | debug | info | warn | error | fatal

  // --- Server ---
  PORT: Number(requireEnv("PORT")),

  // --- Database ---
  MONGO_URI: requireEnv("MONGO_URI"),
  DB_NAME: requireEnv("DB_NAME"),

  // --- Auth ---
  JWT_SECRET: requireEnv("JWT_SECRET"),

  // --- CORS / Client ---
  CLIENT_ORIGIN: requireEnv("CLIENT_ORIGIN"),
};
