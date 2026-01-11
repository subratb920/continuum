import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";

/**
 * Project Service
 * Owns project lifecycle within Continuum.
 * Does NOT decide execution law (handled by execution service).
 */
export function createProjectService(db) {
  const log = withSystemContext("project");

  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  /**
   * List all projects owned by a user
   */
  async function listProjects(userId) {
    const uid = new ObjectId(userId);

    log.debug(
      { userId: uid },
      "Listing projects"
    );

    const projects = await projectCol
      .find({ userId: uid })
      .toArray();

    log.info(
      {
        userId: uid,
        count: projects.length,
      },
      "Projects retrieved"
    );

    return projects;
  }

  /**
   * Create a new project
   */
  async function createProject(userId, name) {
    const uid = new ObjectId(userId);

    if (!name || !name.trim()) {
      log.warn(
        { userId: uid },
        "Project creation rejected: empty name"
      );
      throw new Error("Project name is required");
    }

    const doc = {
      name: name.trim(),
      userId: uid,
      createdAt: new Date(),
      bridgeCount: 0,
    };

    log.debug(
      {
        userId: uid,
        projectName: doc.name,
      },
      "Creating project"
    );

    const { insertedId } = await projectCol.insertOne(doc);

    log.info(
      {
        userId: uid,
        projectId: insertedId,
      },
      "Project created"
    );

    return insertedId;
  }

  /**
   * Delete a project and its bridges
   *
   * NOTE:
   * - Execution service is responsible for preventing deletion
   *   of the currently active project.
   */
  async function deleteProject(userId, projectId) {
    const uid = new ObjectId(userId);
    const pid = new ObjectId(projectId);

    log.warn(
      {
        userId: uid,
        projectId: pid,
      },
      "Deleting project"
    );

    // Delete all bridges under the project
    const bridgeResult = await bridgeCol.deleteMany({
      projectId: pid,
    });

    log.info(
      {
        projectId: pid,
        bridgesDeleted: bridgeResult.deletedCount,
      },
      "Project bridges deleted"
    );

    // Delete the project itself (ownership enforced)
    const result = await projectCol.deleteOne({
      _id: pid,
      userId: uid,
    });

    if (result.deletedCount === 0) {
      log.warn(
        {
          userId: uid,
          projectId: pid,
          reason: "project_not_found_or_not_owned",
        },
        "Project deletion failed"
      );
      throw new Error("Project not found or not owned by user");
    }

    log.info(
      {
        userId: uid,
        projectId: pid,
      },
      "Project deleted"
    );
  }

  return {
    listProjects,
    createProject,
    deleteProject,
  };
}
