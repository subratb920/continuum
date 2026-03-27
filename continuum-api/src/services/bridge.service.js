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
  async function startBridge(projectId, interval, goals = [], ticketUrl) {
    const pid = new ObjectId(projectId);

    log.debug(
      { projectId: pid, interval },
      "Starting bridge"
    );

    console.log("START BRIDGE:", {
      projectId,
      ticketUrl,
      time: new Date().toISOString()
    });

    // Determine next bridge index (chronological spine)
    const counters = db.collection("bridge_counters");

    const result = await counters.findOneAndUpdate(
      { projectId: pid },
      { $inc: { seq: 1 } },
      {
        upsert: true,
        returnDocument: "after",
      }
    );

    // 🔥 ALWAYS handle undefined/null
    let index;

    if (result?.value?.seq != null) {
      index = result.value.seq;
    } else {
      // Fallback: fetch manually
      const doc = await counters.findOne({ projectId: pid });

      if (!doc || typeof doc.seq !== "number") {
        throw new Error("Failed to generate bridge index");
      }

      index = doc.seq;
    }
    // ✅ Normalize session goals (BACKEND LAW)
    const sessionGoals = (goals ?? []).map((g) => ({
      id: g?.id ?? crypto.randomUUID(),
      text: typeof g === "string" ? g : g?.text ?? "",
      status: g?.status ?? "untouched",
    }));

    const doc = {
      projectId: pid,
      index,
      name: `bridge-${index}`,
      status: "draft",
      ticketUrl,
      interval: {
        mode: interval?.mode,
        duration: interval?.duration,
        startedAt: new Date(),
        endedAt: null
      },
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
  // async function updateBridge(bridgeId, updates) {
  //   const bid = new ObjectId(bridgeId);

  //   log.debug(
  //     { bridgeId: bid },
  //     "Updating bridge"
  //   );

  //   const result = await bridgeCol.updateOne(
  //     { _id: bid },
  //     {
  //       $set: {
  //         ...updates,
  //         updatedAt: new Date(),
  //       },
  //     }
  //   );

  //   if (result.matchedCount === 0) {
  //     log.warn(
  //       {
  //         bridgeId: bid,
  //         reason: "bridge_not_found",
  //       },
  //       "Bridge update rejected"
  //     );
  //     throw new Error("Bridge not found");
  //   }

  //   log.info(
  //     { bridgeId: bid },
  //     "Bridge updated"
  //   );
  // }

  async function updateBridge(bridgeId, updates) {
    const bid = new ObjectId(bridgeId);

    const updateDoc = {
      updatedAt: new Date(),
    };

    if (updates.status) {
      updateDoc.status = updates.status;
    }

    if (updates.ended) {
      updateDoc["interval.endedAt"] = new Date();
    }

    if ("sessionGoals" in updates) {
      updateDoc.sessionGoals = updates.sessionGoals;
    }

    if (updates.ticketUrl) {
      updateDoc.ticketUrl = updates.ticketUrl;
    }

    await bridgeCol.updateOne(
      { _id: bid },
      { $set: updateDoc }
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
        ticketUrl: bridges.length > 0 ? bridges[0].ticketUrl : null,
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
