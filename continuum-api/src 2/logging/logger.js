// src/logging/logger.js

import pino from "pino";
import { ENV } from "../config/env.js";
import { REDACTION_RULES } from "./redact.js";

const isDev = ENV.NODE_ENV === "development";

export const logger = pino({
  level: ENV.LOG_LEVEL || "info",

  // 🔐 Centralized redaction policy
  redact: REDACTION_RULES,

  // 🎨 Dev-only pretty printing
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",

          // Log level color semantics
          customColors: {
            trace: "gray",
            debug: "cyan",
            info: "green",
            warn: "yellow",
            error: "red",
            fatal: "bgRed",
          },
        },
      }
    : undefined,
});
