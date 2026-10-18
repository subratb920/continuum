import { getDB } from "../config/db.js";
import { createBridgeService } from "../services/bridge.service.js";
import { createExecutionService } from "../services/execution.service.js";

export async function startBridge(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);
  const executionService = createExecutionService(db);

  const { projectId, interval, sessionGoals, ticketUrl } = req.body;

  req.log.info(
    {
      userId: req.user.id,
      projectId,
      interval,
      ticketUrl,
    },
    "Starting bridge"
  );

  // An agent interval (the brain works the goals) needs the role's "Run agents"
  if (interval?.kind === "agent" && !req.access?.features?.includes("agents_run")) {
    return res.status(403).json({ error: "No feature access: Run agents isn't switched on for your role. Ask your admin.", code: "NO_FEATURE_ACCESS", feature: "agents_run" });
  }

  // 🔒 Enforce execution law FIRST
  await executionService.assertCanStartBridge(
    req.user.id,
    projectId
  );

  // 🔹 Start bridge and get FULL document
  const bridge = await bridgeService.startBridge(
    projectId,
    interval,
    sessionGoals,
    ticketUrl
  );

  req.log.info(
    {
      bridgeId: bridge._id,
      projectId,
    },
    "Bridge started"
  );

  // ✅ MUST return full bridge
  res.status(201).json(bridge);
}


export async function updateBridge(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);

  const bridgeId = req.params.id;

  req.log.info(
    {
      userId: req.user.id,
      bridgeId,
    },
    "Updating bridge"
  );

  await bridgeService.updateBridge(
    bridgeId,
    req.body
  );

  req.log.info(
    {
      bridgeId,
    },
    "Bridge updated"
  );

  res.json({ success: true });
}

export async function getProjectBridges(req, res) {
  const db = getDB();
  const bridgeService = createBridgeService(db);

  const projectId = req.params.id;

  req.log.debug(
    {
      userId: req.user.id,
      projectId,
    },
    "Listing project bridges"
  );

  const bridges = await bridgeService.listBridges(projectId);

  req.log.info(
    {
      projectId,
      count: bridges.length,
    },
    "Project bridges retrieved"
  );

  res.json(bridges);
}
