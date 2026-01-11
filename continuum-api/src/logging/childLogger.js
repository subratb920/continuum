// src/logging/childLogger.js

import { logger } from "./logger.js";

/**
 * Create a request-scoped child logger
 *
 * This logger automatically carries:
 * - requestId (from pino-http)
 * - userId (if authenticated)
 *
 * Usage:
 *   const log = withRequestContext(req);
 *   log.info({ projectId }, "Project created");
 */
export function withRequestContext(req) {
  return logger.child({
    requestId: req.id,
    userId: req.user?.id || null,
  });
}

/**
 * Create a user-scoped logger (non-HTTP contexts)
 *
 * Useful for:
 * - bootstrap
 * - background jobs
 * - invariant repair
 * - system tasks
 */
export function withUserContext(userId) {
  return logger.child({
    userId,
  });
}

/**
 * Create a system-scoped logger
 *
 * Use for:
 * - bootstrap
 * - DB connectivity
 * - startup / shutdown
 */
export function withSystemContext(component) {
  return logger.child({
    system: component,
  });
}
