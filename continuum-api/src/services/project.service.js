import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { createProjectDoc } from "../models/project.model.js";

export async function createProjectService(db) {
  const log = withSystemContext("project");

  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  const toObjectId = (id) =>
    typeof id === "string" ? new ObjectId(id) : id;

  /**
   * List all projects owned by a user
   */
  async function listProjects(userId) {
    const uid = toObjectId(userId);

    const projects = await projectCol
      .find({ userId: uid })
      .sort({ createdAt: -1 }) // 🔥 FIX
      .toArray();

    return projects;
  }

  /**
   * Create a LOCAL project
   */
  async function createProject(userId, name) {
    const uid = toObjectId(userId);

    if (!name || !name.trim()) {
      throw new Error("Project name is required");
    }

    const cleanName = name.trim();

    // 🔥 prevent duplicates
    const existing = await projectCol.findOne({
      userId: uid,
      name: cleanName,
      source: "local",
    });

    if (existing) {
      return existing._id;
    }

    log.info({ userId: uid, name: cleanName }, "Creating project");

    const doc = createProjectDoc({
      name: cleanName,
      userId: uid,
      source: "local",
    });

    const { insertedId } = await projectCol.insertOne(doc);

    return insertedId;
  }

  /**
   * Create project from GitHub repo
   */
  async function createProjectFromGithub(userId, repo) {
    const uid = toObjectId(userId);

    const existing = await projectCol.findOne({
      userId: uid,
      githubRepoId: repo.id,
    });

    if (existing) {
      return existing._id;
    }

    const doc = createProjectDoc({
      name: repo.name,
      userId: uid,
      source: "github",
      githubRepoId: repo.id,
      githubRepoUrl: repo.html_url,
      visibility: repo.private ? "private" : "public",
      fullName: repo.full_name,
    });

    const { insertedId } = await projectCol.insertOne(doc);

    return insertedId;
  }

  /**
   * Delete project
   */
  async function deleteProject(userId, projectId) {
    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    await bridgeCol.deleteMany({
      projectId: pid,
    });

    const result = await projectCol.deleteOne({
      _id: pid,
      userId: uid,
    });

    if (result.deletedCount === 0) {
      throw new Error("Project not found or not owned by user");
    }
  }

  return {
    listProjects,
    createProject,
    createProjectFromGithub,
    deleteProject,
  };
}