import { getDB } from "../config/db.js";
import { createBridgeService } from "../services/bridge.service.js";
import { createExecutionService } from "../services/execution.service.js";

export async function startBridge(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);
  const executionService = createExecutionService(db);

  const { projectId, interval, sessionGoals } = req.body;

  // 🔒 Enforce execution law FIRST
  await executionService.assertCanStartBridge(
    req.user.id,
    projectId
  );

  const bridgeId = await bridgeService.startBridge(
    projectId,
    interval,
    sessionGoals
  );

  res.status(201).json({ bridgeId });
}

export async function updateBridge(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);

  await bridgeService.updateBridge(
    req.params.id,
    req.body
  );

  res.json({ success: true });
}

export async function getProjectBridges(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);

  const bridges = await bridgeService.listBridges(req.params.id);

  res.json(bridges);
}
