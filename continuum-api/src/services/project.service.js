import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { createProjectDoc } from "../models/project.model.js";
import { AppError } from "../errors/AppError.js";

export async function createProjectService(db) {
  const log = withSystemContext("project");

  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);
  const executionCol = db.collection(EXECUTION_COLLECTION);

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
   * Delete project and the data that belongs to it
   * - ownership is checked BEFORE anything is deleted
   */
  async function deleteProject(userId, projectId) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }

    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    // Scoped to the owner, so another user's project id can't delete anything
    const result = await projectCol.deleteOne({
      _id: pid,
      userId: uid,
    });

    if (result.deletedCount === 0) {
      throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
    }

    const { deletedCount: bridgesDeleted } = await bridgeCol.deleteMany({
      projectId: pid,
    });

    await db.collection("bridge_counters").deleteOne({ projectId: pid });

    // Clear the active-project pointer if it referenced this project
    await executionCol.updateOne(
      { userId: uid, activeProjectId: pid },
      { $set: { activeProjectId: null, updatedAt: new Date() } }
    );

    log.info({ userId: uid, projectId: pid, bridgesDeleted }, "Project deleted");

    return { bridgesDeleted };
  }

  return {
    listProjects,
    createProject,
    createProjectFromGithub,
    deleteProject,
  };
}