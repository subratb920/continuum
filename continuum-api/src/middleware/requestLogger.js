// src/middleware/requestLogger.js

import { randomUUID } from "crypto";
import { logger } from "../logging/logger.js";

/**
 * Attaches a request-scoped logger to every request.
 * Also assigns req.id for audit & correlation.
 */
export function requestLogger(req, res, next) {
  const requestId = randomUUID();

  // 🔑 Attach requestId to request (CRITICAL)
  req.id = requestId;

  const reqLog = logger.child({
    requestId,
    method: req.method,
    // A sign-in token in the address (the brain's live stream) never reaches the log
    path: req.originalUrl.replace(/([?&]token=)[^&]*/g, "$1[hidden]"),
  });

  req.log = reqLog;

  const start = Date.now();

  // Request start
  reqLog.info("Request started");

  res.on("finish", () => {
    const durationMs = Date.now() - start;

    const level =
      res.statusCode >= 500
        ? "error"
        : res.statusCode >= 400
        ? "warn"
        : "info";

    reqLog[level](
      {
        statusCode: res.statusCode,
        durationMs,
      },
      "Request completed"
    );
  });

  next();
}
