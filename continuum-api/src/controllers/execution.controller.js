import { getDB } from "../config/db.js";
import { createExecutionService } from "../services/execution.service.js";

export async function getActiveProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  req.log.debug(
    {
      userId: req.user.id,
    },
    "Fetching active project"
  );

  const activeProjectId = await executionService.getActiveProject(req.user.id);

  req.log.info(
    {
      userId: req.user.id,
      activeProjectId,
    },
    "Active project retrieved"
  );

  res
  .set("Cache-Control", "no-store")
  .set("Pragma", "no-cache")
  .json({ activeProjectId });
}

export async function activateProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  const { projectId } = req.body;

  req.log.info(
    {
      userId: req.user.id,
      projectId,
    },
    "Activating project"
  );

  await executionService.activateProject(
    req.user.id,
    projectId
  );

  req.log.info(
    {
      userId: req.user.id,
      projectId,
    },
    "Project activated"
  );

  res.json({ success: true });
}

export async function deactivateProject(req, res) {
  const db = getDB();
  const executionService = createExecutionService(db);

  req.log.info(
    {
      userId: req.user.id,
    },
    "Deactivating active project"
  );

  await executionService.deactivateProject(req.user.id);

  req.log.info(
    {
      userId: req.user.id,
    },
    "Active project deactivated"
  );

  res.json({ success: true });
}
