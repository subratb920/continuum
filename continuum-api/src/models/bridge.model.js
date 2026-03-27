// src/models/bridge.model.js
import { ObjectId } from "mongodb";

export const BRIDGE_COLLECTION = "bridges";

/**
 * Create a Bridge document (draft)
 *
 * Produces shape:
 * {
 *   projectId: ObjectId,
 *   projectName?: string,
 *   bridgeName: string,
 *   index: number,
 *   status: "draft",
 *   interval: { mode, duration, startedAt },
 *   sessionGoals: [{ id, text, status }],
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */
export function createBridgeDoc({
  projectId,
  projectName,
  index,
  interval = {},
  sessionGoals = [],
  ticketUrl = null
}) {
  return {
    // Persist projectId as ObjectId (or leave as-is if already one)
    projectId: typeof projectId === "string"
      ? new ObjectId(projectId)
      : projectId,

    // Snapshot project name to avoid historical drift (optional)
    ...(projectName ? { projectName } : {}),

    // Stable bridge naming + index
    bridgeName: `bridge-${index}`,
    index,

    // lifecycle status (explicit)
    status: "draft",

    // Link to GitHub / Jira / ticket system
    ticketUrl: ticketUrl ?? null,

    // Historical snapshot of the interval settings
    interval: {
      mode: interval?.mode ?? null,
      duration: typeof interval?.duration === "number" ? interval.duration : null,
      startedAt: new Date(),
    },

    // Normalize incoming sessionGoals (accept array of strings OR objects)
    sessionGoals: normalizeSessionGoals(sessionGoals),

    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/* -------------------------
   Helper: normalizeSessionGoals
   - Accepts array of:
     - strings -> converted to { id, text, status: 'untouched' }
     - objects -> normalized to { id?, text, status? }
   - Guarantees UI-safe shape.
-------------------------- */
function normalizeSessionGoals(goals = []) {
  if (!Array.isArray(goals)) return [];

  return goals.map((g, i) => {
    // Already an object with text
    if (g && typeof g === "object" && ("text" in g || "id" in g)) {
      return {
        id: g.id ?? `g${i + 1}`,
        text: typeof g.text === "string" ? g.text : String(g.text ?? ""),
        status: g.status ?? "untouched",
      };
    }

    // Legacy string input
    return {
      id: `g${i + 1}`,
      text: String(g ?? ""),
      status: "untouched",
    };
  });
}

/**
 * Normalize bridge ID to ObjectId for queries
 */
export function toBridgeId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}
