import { ObjectId } from "mongodb";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";

export function createBridgeService(db) {
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  async function startBridge(projectId, interval, goals) {
    const count = await bridgeCol.countDocuments({
      projectId: new ObjectId(projectId),
    });

    const doc = {
      projectId: new ObjectId(projectId),
      index: count + 1,
      name: `bridge-${count + 1}`,
      status: "draft",
      interval,
      sessionGoals: goals,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId } = await bridgeCol.insertOne(doc);
    return insertedId;
  }

  async function updateBridge(bridgeId, updates) {
    await bridgeCol.updateOne(
      { _id: new ObjectId(bridgeId) },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );
  }

  async function listBridges(projectId) {
    return bridgeCol
      .find({ projectId: new ObjectId(projectId) })
      .sort({ index: 1 })
      .toArray();
  }

  return {
    startBridge,
    updateBridge,
    listBridges,
  };
}
