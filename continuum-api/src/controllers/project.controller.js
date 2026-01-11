import { getDB } from "../config/db.js";
import { createProjectService } from "../services/project.service.js";
import { createAuditService } from "../audit/audit.service.js";
import { AUDIT_EVENTS } from "../audit/audit.types.js";

export async function getProjects(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);

  req.log.debug(
    {
      userId: req.user.id,
    },
    "Listing projects"
  );

  const projects = await projectService.listProjects(req.user.id);

  req.log.info(
    {
      userId: req.user.id,
      count: projects.length,
    },
    "Projects retrieved"
  );

  res.json(projects);
}

export async function createProject(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);
  const audit = createAuditService(db);

  const { name } = req.body;

  req.log.info(
    {
      userId: req.user.id,
      projectName: name,
    },
    "Creating project"
  );

  const projectId = await projectService.createProject(
    req.user.id,
    name
  );

  // 🔒 IMMUTABLE AUDIT LOG
  await audit.logEvent({
    type: AUDIT_EVENTS.PROJECT_CREATED,
    userId: req.user.id,
    projectId,
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  req.log.info(
    {
      userId: req.user.id,
      projectId,
    },
    "Project created"
  );

  res.status(201).json({ projectId });
}

export async function deleteProject(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);
  const audit = createAuditService(db);

  const projectId = req.params.id;

  req.log.warn(
    {
      userId: req.user.id,
      projectId,
    },
    "Deleting project"
  );

  await projectService.deleteProject(
    req.user.id,
    projectId
  );

  // 🔒 IMMUTABLE AUDIT LOG
  await audit.logEvent({
    type: AUDIT_EVENTS.PROJECT_DELETED,
    userId: req.user.id,
    projectId,
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  req.log.info(
    {
      userId: req.user.id,
      projectId,
    },
    "Project deleted"
  );

  res.json({ success: true });
}
