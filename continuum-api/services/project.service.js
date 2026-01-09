import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";

export function createProjectService(db) {
  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);

  async function listProjects(userId) {
    return projectCol.find({ userId: new ObjectId(userId) }).toArray();
  }

  async function createProject(userId, name) {
    const doc = {
      name: name.trim(),
      userId: new ObjectId(userId),
      createdAt: new Date(),
      bridgeCount: 0,
    };

    const { insertedId } = await projectCol.insertOne(doc);
    return insertedId;
  }

  async function deleteProject(userId, projectId) {
    const pid = new ObjectId(projectId);

    await bridgeCol.deleteMany({ projectId: pid });

    await projectCol.deleteOne({
      _id: pid,
      userId: new ObjectId(userId),
    });
  }

  return {
    listProjects,
    createProject,
    deleteProject,
  };
}
