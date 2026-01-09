// src/models/bridge.model.js
import { ObjectId } from "mongodb";

export const BRIDGE_COLLECTION = "bridges";

/**
 * Create a Bridge (interval) document
 */
export function createBridgeDoc({
  projectId,
  index,
  interval,
  sessionGoals,
}) {
  return {
    projectId: typeof projectId === "string"
      ? new ObjectId(projectId)
      : projectId,

    index,
    name: `bridge-${index}`,
    status: "draft",

    interval: {
      ...interval,
      startedAt: new Date(),
    },

    sessionGoals: sessionGoals.map((text, i) => ({
      id: `g${i + 1}`,
      text,
      status: "untouched",
    })),

    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Normalize bridge ID
 */
export function toBridgeId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}
