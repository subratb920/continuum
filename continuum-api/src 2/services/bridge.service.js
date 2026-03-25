import { ObjectId } from "mongodb";
import crypto from "crypto";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { withSystemContext } from "../logging/childLogger.js";

export function createBridgeService(db) {
  const log = withSystemContext("bridge");
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  /**
   * Start a new bridge (draft)
   * Assumes execution law has already been enforced.
   */
  async function startBridge(projectId, interval, goals) {
    const pid = new ObjectId(projectId);

    log.debug(
      { projectId: pid, interval },
      "Starting bridge"
    );

    // Determine next bridge index (chronological spine)
    const count = await bridgeCol.countDocuments({
      projectId: pid,
    });

    const index = count + 1;

    // ✅ Normalize session goals (BACKEND LAW)
    const sessionGoals = (goals ?? []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      status: "untouched",
    }));

    const doc = {
      projectId: pid,
      index,
      name: `bridge-${index}`,
      status: "draft",
      interval,
      sessionGoals,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await bridgeCol.insertOne(doc);

    log.info(
      {
        bridgeId: insertedId,
        projectId: pid,
        index,
      },
      "Bridge started"
    );

    // ✅ RETURN FULL BRIDGE OBJECT
    return {
      ...doc,
      _id: insertedId,
    };
  }

  /**
   * Update an existing bridge
   */
  async function updateBridge(bridgeId, updates) {
    const bid = new ObjectId(bridgeId);

    log.debug(
      { bridgeId: bid },
      "Updating bridge"
    );

    const result = await bridgeCol.updateOne(
      { _id: bid },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      log.warn(
        {
          bridgeId: bid,
          reason: "bridge_not_found",
        },
        "Bridge update rejected"
      );
      throw new Error("Bridge not found");
    }

    log.info(
      { bridgeId: bid },
      "Bridge updated"
    );
  }

  /**
   * List all bridges for a project (chronological order)
   */
  async function listBridges(projectId) {
    const pid = new ObjectId(projectId);

    log.debug(
      { projectId: pid },
      "Listing bridges"
    );

    const bridges = await bridgeCol
      .find({ projectId: pid })
      .sort({ index: 1 })
      .toArray();

    log.info(
      {
        projectId: pid,
        count: bridges.length,
      },
      "Bridges retrieved"
    );

    return bridges;
  }

  return {
    startBridge,
    updateBridge,
    listBridges,
  };
}
