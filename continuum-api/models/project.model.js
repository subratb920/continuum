// src/models/project.model.js
import { ObjectId } from "mongodb";

export const PROJECT_COLLECTION = "projects";

/**
 * Create a new Project document
 */
export function createProjectDoc({ name, userId }) {
  return {
    name: name.trim(),
    userId: typeof userId === "string" ? new ObjectId(userId) : userId, 
    createdAt: new Date(),
    bridgeCount: 0, 
  };
}

/**
 * Normalize a project ID
 */
export function toProjectId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}
