import { ObjectId } from "mongodb";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { mineFilter } from "./bridgeAccess.js";
import { canWrite, findProject, personalSpace, projectFilter } from "../spaces/projectAccess.js";
import { AppError } from "../errors/AppError.js";

// Your active project is one per space: your personal space's is activeProjectId
// (as before spaces, and what the brain reads); an organization's is
// activeBySpace["o:<id>"]. Each person has their own, even on a shared project.
const pointer = (space) => (space?.kind === "org" ? `activeBySpace.${space.id}` : "activeProjectId");
const activeIn = (state, space) => (space?.kind === "org" ? state.activeBySpace?.[space.id] ?? null : state.activeProjectId ?? null);

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
  async function getActiveProject(userId, space = personalSpace(userId)) {
    const uid = toObjectId(userId);

    log.debug({ userId: uid, spaceId: space.id }, "Fetching active project");

    const state = await getExecutionState(uid);
    const active = activeIn(state, space);

    if (!active) {
      return null;
    }

    // Still one you can see (in an organization, your departments may have changed)
    const project = await projectCol.findOne({
      _id: active,
      ...projectFilter(space, uid),
    });

    return project || null;
  }

  /**
   * Activate project
   */
  async function activateProject(userId, projectId, space = personalSpace(userId)) {
    const uid = toObjectId(userId);

    log.debug({ userId: uid, projectId, spaceId: space.id }, "Activating project");

    let project;
    try {
      project = await findProject(db, space, uid, String(projectId ?? ""), { projection: { _id: 1 } });
    } catch (err) {
      log.warn({ userId: uid, projectId, spaceId: space.id }, "Project activation rejected");
      throw err;
    }
    const pid = project._id;

    const result = await executionCol.updateOne(
      { userId: uid },
      {
        $set: {
          userId: uid,
          [pointer(space)]: pid,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    if (result.matchedCount === 0) {
      throw new Error("Execution state update failed");
    }

    log.info({ userId: uid, projectId: pid }, "Project activated");
  }

  /**
   * Deactivate project
   */
  async function deactivateProject(userId, space = personalSpace(userId)) {
    const uid = toObjectId(userId);

    const result = await executionCol.updateOne(
      { userId: uid },
      space.kind === "org"
        ? { $unset: { [pointer(space)]: "" }, $set: { updatedAt: new Date() } }
        : {
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
  async function assertCanStartBridge(userId, projectId, space = personalSpace(userId)) {
    const uid = toObjectId(userId);

    // A viewer only looks; and it must be a project you can still see here
    if (!canWrite(space)) throw new AppError("You can only look at this organization's projects (you're a viewer).", 403, "READ_ONLY");
    const pid = (await findProject(db, space, uid, String(projectId ?? ""), { need: "write", projection: { _id: 1 } }))._id;

    const state = await getExecutionState(uid);
    const active = activeIn(state, space);

    if (!active) {
      throw new Error("No active project");
    }

    if (!active.equals(pid)) {
      throw new Error("Project is not active");
    }

    // Auto-abandon your own earlier draft on it (never another person's)
    const project = await projectCol.findOne({ _id: pid }, { projection: { userId: 1 } });
    const existingDraft = await bridgeCol.findOne({
      projectId: pid,
      status: "draft",
      ...mineFilter(uid, Boolean(project?.userId?.equals(uid))),
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