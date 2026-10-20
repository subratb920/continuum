import { getDB } from "../config/db.js";
import { createProjectService } from "../services/project.service.js";
import { createAuditService } from "../audit/audit.service.js";
import { AUDIT_EVENTS } from "../audit/audit.types.js";

export async function getProjects(req, res) {
  const db = getDB();
  const projectService = await createProjectService(db);

  req.log.debug(
    {
      userId: req.user.id,
    },
    "Listing projects"
  );

  const projects = await projectService.listProjects(req.user.id, req.space);

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
  const projectService = await createProjectService(db);
  const audit = createAuditService(db);

  const { name, source, contents, githubRepoUrl, departmentIds } = req.body;

  req.log.info(
    {
      userId: req.user.id,
      projectName: name,
    },
    "Creating project"
  );

  const projectId = await projectService.createProject(
    req.user.id,
    name,
    { source, contents, githubRepoUrl, departmentIds },
    req.space
  );

  // 🔒 IMMUTABLE AUDIT LOG
  await audit.logEvent({
    type: AUDIT_EVENTS.PROJECT_CREATED,
    userId: req.user.id,
    projectId,
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: { spaceId: req.space?.id },
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

export async function getProjectContents(req, res) {
  const db = getDB();
  const projectService = await createProjectService(db);
  const contents = await projectService.getProjectContents(req.user.id, req.params.id, req.space);
  res.json(contents);
}

export async function renameProject(req, res) {
  const db = getDB();
  const projectService = await createProjectService(db);
  const audit = createAuditService(db);

  const projectId = req.params.id;
  const name = req.body?.name; // name is the only editable property

  req.log.info(
    {
      userId: req.user.id,
      projectId,
    },
    "Renaming project"
  );

  const project = await projectService.renameProject(
    req.user.id,
    projectId,
    name,
    req.space
  );

  // 🔒 IMMUTABLE AUDIT LOG
  await audit.logEvent({
    type: AUDIT_EVENTS.PROJECT_RENAMED,
    userId: req.user.id,
    projectId,
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: { name: project.name },
  });

  res.json(project);
}

export async function deleteProject(req, res) {
  const db = getDB();
  const projectService = await createProjectService(db);
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
    projectId,
    req.space
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


// An organization's project: which departments see it (none: every member)
export async function setProjectDepartments(req, res) {
  const db = getDB();
  const projectService = await createProjectService(db);
  const audit = createAuditService(db);

  const r = await projectService.setProjectDepartments(req.user.id, req.params.id, req.body?.departmentIds, req.space);

  await audit.logEvent({
    type: AUDIT_EVENTS.PROJECT_DEPARTMENTS_SET,
    userId: req.user.id,
    projectId: req.params.id,
    requestId: req.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: { spaceId: req.space?.id, departmentIds: r.departmentIds },
  });

  res.json(r);
}
