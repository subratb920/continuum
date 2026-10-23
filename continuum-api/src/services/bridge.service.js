import { ObjectId } from "mongodb";
import crypto from "crypto";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { finish, kindOf } from "./agentBridge.js";
import { bridgeFor, mineFilter, ownsProject } from "./bridgeAccess.js";

export function createBridgeService(db) {
  const log = withSystemContext("bridge");
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  /**
   * Start a new bridge (draft)
   * Assumes execution law has already been enforced.
   */
  async function startBridge(userId, projectId, interval, goals = [], ticketUrl) {
    const pid = new ObjectId(projectId);
    const uid = new ObjectId(String(userId));

    log.debug(
      { projectId: pid, interval },
      "Starting bridge"
    );

    console.log("START BRIDGE:", {
      projectId,
      ticketUrl,
      time: new Date().toISOString()
    });

    // Determine next bridge index (chronological spine): each person's own on the project.
    // The project's owner carries on from the count before bridges had owners
    const counters = db.collection("bridge_counters");
    if (!(await counters.findOne({ projectId: pid, userId: uid }))) {
      const before = (await ownsProject(db, pid, uid)) ? await counters.findOne({ projectId: pid, userId: { $exists: false } }) : null;
      await counters.updateOne({ projectId: pid, userId: uid }, { $setOnInsert: { seq: before?.seq ?? 0 } }, { upsert: true });
    }

    const result = await counters.findOneAndUpdate(
      { projectId: pid, userId: uid },
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
      const doc = await counters.findOne({ projectId: pid, userId: uid });

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
      // Whose bridge it is: only they see and change it
      userId: uid,
      index,
      name: `bridge-${index}`,
      status: "draft",
      ticketUrl,
      interval: {
        // human: a person's, timed; agent: the brain works the goals and ends it (no duration)
        kind: interval?.kind === "agent" ? "agent" : "human",
        mode: interval?.mode,
        duration: interval?.kind === "agent" ? null : interval?.duration,
        // An agent interval works in the user's folder (sent from their computer) or in GitHub (a phone)
        ...(interval?.kind === "agent" ? { workFrom: interval?.workFrom === "device" ? "device" : "github" } : {}),
        startedAt: new Date(),
        endedAt: null
      },
      sessionGoals,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await bridgeCol.insertOne(doc);
    // Keep the project's bridge count current (read by projectView and the brain); the per-user counter above is the index, not this total.
    await db.collection(PROJECT_COLLECTION).updateOne({ _id: pid }, { $inc: { bridgeCount: 1 } });

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

  async function updateBridge(userId, bridgeId, updates) {
    // Only your own bridge
    const current = await bridgeFor(db, bridgeId, userId);
    if (!current) return false;
    const bid = current._id;

    // An agent interval's goals are the brain's (service routes): the person can only
    // stop it, which saves it as it stands, with who worked on what
    if (current && kindOf(current) === "agent") {
      const set = { updatedAt: new Date() };
      if (updates.ticketUrl) set.ticketUrl = updates.ticketUrl;
      if (updates.status === "finalized" && current.status === "draft") Object.assign(set, finish(current, { by: "person", agentNames: updates.agentNames ?? {} }));
      await bridgeCol.updateOne({ _id: bid }, { $set: set });
      return true;
    }

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
    return true;
  }

  /**
   * List all bridges for a project (chronological order)
   */
  async function listBridges(userId, projectId) {
    const pid = new ObjectId(projectId);

    log.debug(
      { projectId: pid },
      "Listing bridges"
    );

    // Only this person's bridges on the project (on their own project, also those from before owners)
    const bridges = await bridgeCol
      .find({ projectId: pid, ...mineFilter(userId, await ownsProject(db, pid, userId)) })
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
