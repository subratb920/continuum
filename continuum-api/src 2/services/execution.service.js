import { ObjectId } from "mongodb";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";

/**
 * Execution Service
 * This is the LAW of Continuum.
 * Controllers ask. This decides.
 *
 * Bridge statuses:
 * - draft      → active interval
 * - final      → completed normally
 * - abandoned  → interrupted / superseded
 */
export function createExecutionService(db) {
  const log = withSystemContext("execution");

  const executionCol = db.collection(EXECUTION_COLLECTION);
  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  /**
   * Internal helper
   * Always returns a valid execution state or fails loudly.
   */
  async function getExecutionState(userId) {
    const state = await executionCol.findOne({ userId });

    if (!state) {
      log.error({ userId }, "Execution state missing");
      throw new Error("Execution state missing for user");
    }

    return state;
  }

  /**
   * Get active project for a user
   */
  async function getActiveProject(userId) {
    const uid = new ObjectId(userId);

    log.debug({ userId: uid }, "Fetching active project");

    const state = await getExecutionState(uid);
    return state.activeProjectId || null;
  }

  /**
   * Activate a project
   */
  async function activateProject(userId, projectId) {
    const uid = new ObjectId(userId);
    const pid = new ObjectId(projectId);

    log.debug(
      { userId: uid, projectId: pid },
      "Activating project"
    );

    // Ownership enforcement
    const project = await projectCol.findOne({
      _id: pid,
      userId: uid,
    });

    if (!project) {
      log.warn(
        {
          userId: uid,
          projectId: pid,
          reason: "project_not_owned",
        },
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
      log.error(
        { userId: uid },
        "Execution state update failed during activation"
      );
      throw new Error("Execution state update failed");
    }

    log.info(
      { userId: uid, projectId: pid },
      "Project activated"
    );
  }

  /**
   * Deactivate current project
   */
  async function deactivateProject(userId) {
    const uid = new ObjectId(userId);

    log.debug({ userId: uid }, "Deactivating active project");

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
      log.error(
        { userId: uid },
        "Execution state update failed during deactivation"
      );
      throw new Error("Execution state update failed");
    }

    log.info({ userId: uid }, "Active project deactivated");
  }

  /**
   * Can a bridge be started?
   * Enforces ALL execution invariants.
   *
   * ✅ AUTO-ARCHIVES any existing draft bridge
   */
  async function assertCanStartBridge(userId, projectId) {
    const uid = new ObjectId(userId);
    const pid = new ObjectId(projectId);

    log.debug(
      { userId: uid, projectId: pid },
      "Checking if bridge can be started"
    );

    const state = await getExecutionState(uid);

    if (!state.activeProjectId) {
      log.warn(
        { userId: uid, reason: "no_active_project" },
        "Bridge start rejected"
      );
      throw new Error("No active project");
    }

    if (!state.activeProjectId.equals(pid)) {
      log.warn(
        {
          userId: uid,
          activeProjectId: state.activeProjectId,
          requestedProjectId: pid,
          reason: "project_not_active",
        },
        "Bridge start rejected"
      );
      throw new Error("Project is not active");
    }

    // 🔁 AUTO-ARCHIVE EXISTING DRAFT (KEY FIX)
    const existingDraft = await bridgeCol.findOne({
      projectId: pid,
      status: "draft",
    });

    if (existingDraft) {
      log.warn(
        {
          userId: uid,
          projectId: pid,
          bridgeId: existingDraft._id,
          reason: "auto_abandon_previous_draft",
        },
        "Auto-archiving previous draft bridge"
      );

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

    log.debug(
      { userId: uid, projectId: pid },
      "Bridge start permitted"
    );
  }

  return {
    getActiveProject,
    activateProject,
    deactivateProject,
    assertCanStartBridge,
  };
}
