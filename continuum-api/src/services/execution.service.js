import { ObjectId } from "mongodb";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";

export function createExecutionService(db) {
  const log = withSystemContext("execution");

  const executionCol = db.collection(EXECUTION_COLLECTION);
  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  // ✅ SINGLE SOURCE OF TRUTH
  const toObjectId = (id) =>
    typeof id === "string" ? new ObjectId(id) : id;

  /**
   * Always returns execution state
   */
  async function getExecutionState(userId) {
    const uid = toObjectId(userId);

    const state = await executionCol.findOne({ userId: uid });

    if (!state) {
      log.error({ userId: uid }, "Execution state missing");
      throw new Error("Execution state missing for user");
    }

    return state;
  }

  /**
   * Get FULL active project (FIXED)
   */
  async function getActiveProject(userId) {
    const uid = toObjectId(userId);

    log.debug({ userId: uid }, "Fetching active project");

    const state = await getExecutionState(uid);

    if (!state.activeProjectId) {
      return null;
    }

    const project = await projectCol.findOne({
      _id: state.activeProjectId,
      userId: uid,
    });

    return project || null;
  }

  /**
   * Activate project
   */
  async function activateProject(userId, projectId) {
    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    log.debug({ userId: uid, projectId: pid }, "Activating project");

    const project = await projectCol.findOne({
      _id: pid,
      userId: uid,
    });

    if (!project) {
      log.warn(
        { userId: uid, projectId: pid },
        "Project activation rejected"
      );
      throw new Error("Project not found or not owned by user");
    }

    const result = await executionCol.updateOne(
      { userId: uid },
      {
        $set: {
          activeProjectId: pid,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new Error("Execution state update failed");
    }

    log.info({ userId: uid, projectId: pid }, "Project activated");
  }

  /**
   * Deactivate project
   */
  async function deactivateProject(userId) {
    const uid = toObjectId(userId);

    const result = await executionCol.updateOne(
      { userId: uid },
      {
        $set: {
          activeProjectId: null,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new Error("Execution state update failed");
    }

    log.info({ userId: uid }, "Project deactivated");
  }

  /**
   * Execution LAW enforcement
   */
  async function assertCanStartBridge(userId, projectId) {
    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    const state = await getExecutionState(uid);

    if (!state.activeProjectId) {
      throw new Error("No active project");
    }

    if (!state.activeProjectId.equals(pid)) {
      throw new Error("Project is not active");
    }

    // Auto-abandon draft
    const existingDraft = await bridgeCol.findOne({
      projectId: pid,
      status: "draft",
    });

    if (existingDraft) {
      await bridgeCol.updateOne(
        { _id: existingDraft._id },
        {
          $set: {
            status: "abandoned",
            abandonedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  return {
    getActiveProject,
    activateProject,
    deactivateProject,
    assertCanStartBridge,
  };
}