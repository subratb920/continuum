import { writeAuditLog } from "./audit.logger.js";

/**
 * Security-grade audit logging.
 * Explicit, intentional, immutable.
 */
export function createAuditService(db) {
  async function logEvent({
    type,
    userId,
    projectId,
    bridgeId,
    requestId,
    ip,
    userAgent,
    metadata = {},
  }) {
    await writeAuditLog(db, {
      type,
      userId,
      projectId,
      bridgeId,
      requestId,
      ip,
      userAgent,
      metadata,
    });
  }

  return {
    logEvent,
  };
}
