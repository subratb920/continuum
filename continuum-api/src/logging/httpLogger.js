// src/logging/httpLogger.js

import pinoHttp from "pino-http";
import { logger } from "./logger.js";

/**
 * HTTP request / response logging middleware
 *
 * Responsibilities:
 * - Assign a request id
 * - Log request lifecycle (start → end)
 * - Attach logger to req.log
 * - Set log level based on response outcome
 */
export const httpLogger = pinoHttp({
  logger,

  // Generate or reuse request id
  genReqId(req) {
    return req.headers["x-request-id"] || crypto.randomUUID();
  },

  // Decide log level based on response
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  // Shape logged request
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },

    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
