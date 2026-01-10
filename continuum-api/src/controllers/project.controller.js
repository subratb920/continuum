import { getDB } from "../config/db.js";
import { createProjectService } from "../services/project.service.js";

export async function getProjects(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);

  const projects = await projectService.listProjects(req.user.id);

  res.json(projects);
}

export async function createProject(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);

  const { name } = req.body;

  const projectId = await projectService.createProject(
    req.user.id,
    name
  );

  res.status(201).json({ projectId });
}

export async function deleteProject(req, res) {
  const db = getDB();
  const projectService = createProjectService(db);

  await projectService.deleteProject(
    req.user.id,
    req.params.id
  );

  res.json({ success: true });
}
