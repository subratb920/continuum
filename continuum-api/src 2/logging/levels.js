// src/logging/levels.js

/**
 * Log level semantics for Continuum API
 *
 * This file defines WHEN and WHY each log level should be used.
 * It is a discipline document, not a runtime dependency.
 */

export const LOG_LEVELS = {
  trace: {
    severity: 10,
    meaning: "Extremely detailed execution flow",
    usage: [
      "Step-by-step algorithm flow",
      "Temporary deep debugging",
      "Never enabled in production",
    ],
  },

  debug: {
    severity: 20,
    meaning: "Internal system state and decisions",
    usage: [
      "Branch decisions",
      "Computed intermediate values",
      "Diagnostics during development",
    ],
  },

  info: {
    severity: 30,
    meaning: "Expected system behavior",
    usage: [
      "Server startup / shutdown",
      "Successful operations",
      "Normal request lifecycle",
    ],
  },

  warn: {
    severity: 40,
    meaning: "Unexpected but recoverable condition",
    usage: [
      "Invariant violation repaired",
      "Fallback logic used",
      "Deprecated usage detected",
    ],
  },

  error: {
    severity: 50,
    meaning: "Operation failed",
    usage: [
      "Request failed",
      "DB operation failed",
      "External dependency error",
    ],
  },

  fatal: {
    severity: 60,
    meaning: "Unrecoverable system failure",
    usage: [
      "Startup failure",
      "Corrupted critical state",
      "Process must exit immediately",
    ],
  },
};
