import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { createProjectDoc } from "../models/project.model.js";
import { AppError } from "../errors/AppError.js";
import { normalizeContents } from "./projectContents.js";

const MAX_NAME_LENGTH = 100;

// Names are compared trimmed and case-insensitively
const sameName = (a, b) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

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

    // A device project's file list is fetched on its own (getProjectContents); the list carries its summary
    const projects = await projectCol
      .find({ userId: uid }, { projection: { "contents.entries": 0 } })
      .sort({ createdAt: -1 }) // 🔥 FIX
      .toArray();

    return projects;
  }

  /**
   * Create a LOCAL project, or one imported from the user's device
   * (source "device", with the file list taken when the folder was picked).
   */
  async function createProject(userId, name, { source = "local", contents = undefined } = {}) {
    const uid = toObjectId(userId);

    if (!name || !name.trim()) {
      throw new Error("Project name is required");
    }
    if (source !== "local" && source !== "device") {
      throw new AppError("source must be local or device.", 400, "VALIDATION_ERROR");
    }
    const files = source === "device" ? normalizeContents(contents ?? { entries: [] }) : null;

    const cleanName = name.trim();

    // 🔥 prevent duplicates (importing the same folder again refreshes its contents)
    const existing = await projectCol.findOne({
      userId: uid,
      name: cleanName,
      source,
    });

    if (existing) {
      if (files) await projectCol.updateOne({ _id: existing._id }, { $set: { contents: files, updatedAt: new Date() } });
      return existing._id;
    }

    log.info({ userId: uid, name: cleanName, source, files: files?.fileCount }, "Creating project");

    const doc = createProjectDoc({
      name: cleanName,
      userId: uid,
      source,
    });
    if (files) doc.contents = files;

    const { insertedId } = await projectCol.insertOne(doc);

    return insertedId;
  }

  /**
   * A device project's file list (paths and sizes)
   */
  async function getProjectContents(userId, projectId) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }
    const project = await projectCol.findOne(
      { _id: toObjectId(projectId), userId: toObjectId(userId) },
      { projection: { contents: 1, source: 1 } }
    );
    if (!project) throw new AppError("Project not found.", 404, "NOT_FOUND");
    if (!project.contents) throw new AppError("This project has no contents (only projects imported from a device do).", 404, "NO_CONTENTS");
    return project.contents;
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
   * Rename a project (name is the only user-editable property)
   * - a change in capitalization alone is not a different name
   * - names are unique per user (case-insensitive); other users may share them
   * - the name lives only in this document; everything else links by _id
   */
  async function renameProject(userId, projectId, name) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new AppError("Project name is required.", 400, "VALIDATION_ERROR");
    }

    const cleanName = name.trim();

    if (cleanName.length > MAX_NAME_LENGTH) {
      throw new AppError(
        `Project name must be ${MAX_NAME_LENGTH} characters or fewer.`,
        400,
        "VALIDATION_ERROR"
      );
    }

    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    const project = await projectCol.findOne({ _id: pid, userId: uid });

    if (!project) {
      throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
    }

    if (sameName(project.name, cleanName)) {
      throw new AppError(
        "New name must be different from the current name.",
        400,
        "NAME_UNCHANGED"
      );
    }

    // Case-insensitive match among this user's OTHER projects
    const duplicate = await projectCol.findOne(
      { userId: uid, name: cleanName, _id: { $ne: pid } },
      { collation: { locale: "en", strength: 2 } }
    );

    if (duplicate) {
      throw new AppError(
        "Project with same name already exists",
        409,
        "PROJECT_NAME_EXISTS"
      );
    }

    const updatedAt = new Date();

    await projectCol.updateOne(
      { _id: pid, userId: uid },
      { $set: { name: cleanName, updatedAt } }
    );

    log.info(
      { userId: uid, projectId: pid, from: project.name, to: cleanName },
      "Project renamed"
    );

    return { ...project, name: cleanName, updatedAt };
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
    getProjectContents,
    createProjectFromGithub,
    renameProject,
    deleteProject,
  };
}