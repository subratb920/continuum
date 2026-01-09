import { ObjectId } from "mongodb";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";

/**
 * Execution Service
 * This is the LAW of Continuum.
 * Controllers ask. This decides.
 */

export function createExecutionService(db) {
  const executionCol = db.collection(EXECUTION_COLLECTION);
  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  /**
   * Get active project for a user
   */
  async function getActiveProject(userId) {
    const state = await executionCol.findOne({ userId });

    return state?.activeProjectId || null;
  }

  /**
   * Activate a project
   */
  async function activateProject(userId, projectId) {
    const pid = new ObjectId(projectId);

    const project = await projectCol.findOne({
      _id: pid,
      userId: new ObjectId(userId),
    });

    if (!project) {
      throw new Error("Project not found or not owned by user");
    }

    await executionCol.updateOne(
      { userId },
      {
        $set: {
          activeProjectId: pid,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Deactivate current project
   */
  async function deactivateProject(userId) {
    await executionCol.updateOne(
      { userId },
      {
        $set: {
          activeProjectId: null,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Can a bridge be started?
   * This enforces ALL execution invariants.
   */
  async function assertCanStartBridge(userId, projectId) {
    const state = await executionCol.findOne({ userId });

    if (!state?.activeProjectId) {
      throw new Error("No active project");
    }

    if (state.activeProjectId.toString() !== projectId.toString()) {
      throw new Error("Project is not active");
    }

    const draftExists = await bridgeCol.findOne({
      projectId: new ObjectId(projectId),
      status: "draft",
    });

    if (draftExists) {
      throw new Error("Draft bridge already exists");
    }
  }

  return {
    getActiveProject,
    activateProject,
    deactivateProject,
    assertCanStartBridge,
  };
}
