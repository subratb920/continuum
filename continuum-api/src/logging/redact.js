// src/logging/redact.js

export const REDACTION_RULES = {
  paths: [
    // Auth
    "req.headers.authorization",
    "req.headers.cookie",

    // Credentials
    "password",
    "passwordHash",

    // Tokens
    "token",
    "*.token",
    "refreshToken",

    // Secrets
    "*.secret",
    "*.apiKey",
  ],
  censor: "[REDACTED]",
};
