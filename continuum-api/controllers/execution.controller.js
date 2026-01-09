import { getDB } from "../config/db.js";
import { createExecutionService } from "../services/execution.service.js";

export async function getActiveProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  const activeProjectId = await executionService.getActiveProject(req.user.id);

  res.json({ activeProjectId });
}

export async function activateProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  await executionService.activateProject(
    req.user.id,
    req.body.projectId
  );

  res.json({ success: true });
}

export async function deactivateProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  await executionService.deactivateProject(req.user.id);

  res.json({ success: true });
}
