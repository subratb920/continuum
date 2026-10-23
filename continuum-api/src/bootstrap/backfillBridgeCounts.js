import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";

const MARKER = "bridgeCount-backfill-v1";

/**
 * One-time: `project.bridgeCount` stopped being maintained when bridges moved to the
 * per-user `bridge_counters` collection, so existing projects are stuck at 0 (the brain
 * and projectView read this field). Recompute each project's count from its bridges, once,
 * guarded by a marker so it never re-runs. New bridges keep it current via bridge.service.
 */
export async function backfillBridgeCounts(db) {
  const log = withSystemContext("bootstrap");
  const migrations = db.collection("migrations");
  if (await migrations.findOne({ _id: MARKER })) return { ran: false, updated: 0 };
  const counts = await db.collection(BRIDGE_COLLECTION).aggregate([{ $group: { _id: "$projectId", n: { $sum: 1 } } }]).toArray();
  let updated = 0;
  for (const c of counts) {
    if (!c._id) continue;
    const r = await db.collection(PROJECT_COLLECTION).updateOne({ _id: c._id }, { $set: { bridgeCount: c.n } });
    updated += r.modifiedCount;
  }
  await migrations.insertOne({ _id: MARKER, at: new Date(), updated });
  log.info({ updated }, "backfilled project.bridgeCount from bridges (one-time)");
  return { ran: true, updated };
}
