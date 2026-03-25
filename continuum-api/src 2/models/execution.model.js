// src/models/execution.model.js
import { ObjectId } from "mongodb";

export const EXECUTION_COLLECTION = "execution_state";
export const EXECUTION_ID = "continuum";

/**
 * Create initial execution state (singleton)
 */
export function createExecutionStateDoc() {
  return {
    _id: EXECUTION_ID,
    activeProjectId: null,
    updatedAt: new Date(),
  };
}

/**
 * Normalize project ID
 */
export function toExecutionProjectId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}
