import { AUDIT_CONFIG } from "./audit.config.js";
import { getAuditCollectionName } from "./audit.rotate.js";

/**
 * Writes a single immutable audit record.
 * NEVER throws. NEVER mutates. NEVER updates.
 */
export async function writeAuditLog(db, record) {
  if (!AUDIT_CONFIG.enabled) return;

  try {
    const collectionName = getAuditCollectionName();
    const col = db.collection(collectionName);

    await col.insertOne({
      ...record,
      timestamp: new Date(),
    });
  } catch (err) {
    // Audit failure must NEVER break the system
    console.error("AUDIT LOG FAILURE", err);
  }
}
