// src/config/env.js

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }

  return value;
}

export const ENV = {
  PORT: Number(requireEnv("PORT")),

  MONGO_URI: requireEnv("MONGO_URI"),

  DB_NAME: requireEnv("DB_NAME"),

  JWT_SECRET: requireEnv("JWT_SECRET"),

  CLIENT_ORIGIN: requireEnv("CLIENT_ORIGIN"),
};
