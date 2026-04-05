// src/models/project.model.js
import { ObjectId } from "mongodb";

export const PROJECT_COLLECTION = "projects";

/**
 * Create a new Project document (Unified schema)
 */
export function createProjectDoc({
  name,
  userId,
  source = "local",
  githubRepoId = null,
  githubRepoUrl = null,
  visibility = null,
  fullName = null,
}) {
  return {
    name: name.trim(),

    userId:
      typeof userId === "string"
        ? new ObjectId(userId)
        : userId,
    source,
    githubRepoId,
    githubRepoUrl,
    visibility,
    fullName,

    // Existing fields
    createdAt: new Date(),
    updatedAt: new Date(),

    bridgeCount: 0,
  };
}

/**
 * Normalize a project ID
 */
export function toProjectId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}