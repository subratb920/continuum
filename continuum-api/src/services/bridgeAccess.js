// src/services/bridgeAccess.js
//
// Bridges are a person's own: on a project several people share, each one's
// Bridge Spine shows only the bridges they started. A bridge from before
// bridges had owners (no userId) belongs to its project's owner.

import { ObjectId } from "mongodb";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";

const oid = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

/** A filter for this person's bridges (ownsProject: also the ones from before owners). */
export function mineFilter(userId, ownsProject) {
  const uid = oid(userId);
  return ownsProject ? { $or: [{ userId: uid }, { userId: { $exists: false } }] } : { userId: uid };
}

/** Does this person own the project? */
export async function ownsProject(db, projectId, userId) {
  return Boolean(await db.collection(PROJECT_COLLECTION).findOne({ _id: oid(projectId), userId: oid(userId) }, { projection: { _id: 1 } }));
}

/** The bridge if it's this person's, else null (a bridge id that isn't valid: null). */
export async function bridgeFor(db, bridgeId, userId) {
  if (!/^[a-f0-9]{24}$/.test(String(bridgeId))) return null;
  const bridge = await db.collection(BRIDGE_COLLECTION).findOne({ _id: new ObjectId(String(bridgeId)) });
  if (!bridge) return null;
  if (bridge.userId) return bridge.userId.equals(oid(userId)) ? bridge : null;
  return (await ownsProject(db, bridge.projectId, userId)) ? bridge : null;
}
