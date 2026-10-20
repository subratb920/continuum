import { ObjectId } from "mongodb";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { withSystemContext } from "../logging/childLogger.js";
import { createProjectDoc } from "../models/project.model.js";
import { AppError } from "../errors/AppError.js";
import { normalizeContents } from "./projectContents.js";
import { normalizeGithubRepoUrl } from "./githubRemote.js";
import { canWrite, findProject, personalSpace, projectFilter } from "../spaces/projectAccess.js";
import { dir } from "../directory/directory.js";

const MAX_NAME_LENGTH = 100;

// Names are compared trimmed and case-insensitively
const sameName = (a, b) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export async function createProjectService(db) {
  const log = withSystemContext("project");

  const projectCol = db.collection(PROJECT_COLLECTION);
  const bridgeCol = db.collection(BRIDGE_COLLECTION);
  const executionCol = db.collection(EXECUTION_COLLECTION);

  const toObjectId = (id) =>
    typeof id === "string" ? new ObjectId(id) : id;

  // Where a new project goes: your personal space, or the organization (only someone who isn't a viewer)
  function placeIn(space, uid) {
    if (!canWrite(space)) throw new AppError("You can only look at this organization's projects (you're a viewer).", 403, "READ_ONLY");
    return space.kind === "org" ? { spaceId: space.id } : { spaceId: `u:${uid}` };
  }

  // The same project again (by name or repository): in your personal space, yours; in an organization, its own
  const sameSpace = (space, uid) => (space.kind === "org" ? { spaceId: space.id } : projectFilter(space, uid));

  /**
   * A new organization project's departments: any of the organization's for its
   * owners and admins; a member picks among their own (none: everyone sees it).
   */
  async function departmentsFor(space, departmentIds) {
    if (space.kind !== "org" || departmentIds === undefined) return space.kind === "org" ? [] : undefined;
    // Department ids are the directory's (kept as strings on the project)
    const ids = await dir.cleanDepartments(space.orgId, departmentIds);
    if (space.orgRole === "member" && ids.some((d) => !space.departmentIds.includes(d))) {
      throw new AppError("You can only put a project in your own departments.", 403, "NOT_YOUR_DEPARTMENT");
    }
    return ids;
  }

  /**
   * The projects you see in this space (personal: yours; an organization: its
   * projects in your departments, or all of them for its owners and admins)
   */
  async function listProjects(userId, space = personalSpace(userId)) {
    const uid = toObjectId(userId);

    // A device project's file list is fetched on its own (getProjectContents); the list carries its summary
    const projects = await projectCol
      .find(projectFilter(space, uid), { projection: { "contents.entries": 0 } })
      .sort({ createdAt: -1 }) // 🔥 FIX
      .toArray();

    return projects;
  }

  /**
   * Create a LOCAL project, or one imported from the user's device
   * (source "device", with the file list taken when the folder was picked,
   * and its GitHub address when the folder's git remote is on GitHub).
   */
  async function createProject(userId, name, { source = "local", contents = undefined, githubRepoUrl = undefined, departmentIds = undefined } = {}, space = personalSpace(userId)) {
    const uid = toObjectId(userId);
    const place = placeIn(space, uid);

    if (!name || !name.trim()) {
      throw new Error("Project name is required");
    }
    if (source !== "local" && source !== "device") {
      throw new AppError("source must be local or device.", 400, "VALIDATION_ERROR");
    }
    const files = source === "device" ? normalizeContents(contents ?? { entries: [] }) : null;
    const repoUrl = source === "device" ? normalizeGithubRepoUrl(githubRepoUrl) : null;

    const cleanName = name.trim();

    // 🔥 prevent duplicates (importing the same folder again refreshes its contents; in an organization, only your own import of it)
    const existing = await projectCol.findOne({
      ...sameSpace(space, uid),
      ...(space.kind === "org" && source === "device" ? { userId: uid } : {}),
      name: cleanName,
      source,
    });

    if (existing) {
      if (files) await projectCol.updateOne({ _id: existing._id }, { $set: { contents: files, githubRepoUrl: repoUrl, updatedAt: new Date() } });
      return existing._id;
    }

    const depts = await departmentsFor(space, departmentIds);

    log.info({ userId: uid, name: cleanName, source, files: files?.fileCount, spaceId: place.spaceId }, "Creating project");

    const doc = createProjectDoc({
      name: cleanName,
      userId: uid,
      source,
      githubRepoUrl: repoUrl,
    });
    Object.assign(doc, place);
    if (depts) doc.departmentIds = depts;
    if (files) doc.contents = files;

    const { insertedId } = await projectCol.insertOne(doc);

    return insertedId;
  }

  /**
   * A device project's file list (paths and sizes)
   */
  async function getProjectContents(userId, projectId, space = personalSpace(userId)) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }
    const project = await findProject(db, space, userId, projectId, { projection: { contents: 1, source: 1 } });
    if (!project.contents) throw new AppError("This project has no contents (only projects imported from a device do).", 404, "NO_CONTENTS");
    return project.contents;
  }

  /**
   * Create project from GitHub repo
   */
  async function createProjectFromGithub(userId, repo, space = personalSpace(userId), { departmentIds } = {}) {
    const uid = toObjectId(userId);
    const place = placeIn(space, uid);

    const existing = await projectCol.findOne({
      ...sameSpace(space, uid),
      githubRepoId: repo.id,
    });

    if (existing) {
      return existing._id;
    }

    const doc = createProjectDoc({
      name: repo.name,
      userId: uid,
      source: "github",
      githubRepoId: repo.id,
      githubRepoUrl: repo.html_url,
      visibility: repo.private ? "private" : "public",
      fullName: repo.full_name,
    });
    Object.assign(doc, place);
    const depts = await departmentsFor(space, departmentIds);
    if (depts) doc.departmentIds = depts;

    const { insertedId } = await projectCol.insertOne(doc);

    return insertedId;
  }

  /**
   * Rename a project (name is the only user-editable property)
   * - a change in capitalization alone is not a different name
   * - names are unique per space (case-insensitive): your personal projects, or an organization's
   * - the name lives only in this document; everything else links by _id
   * - in an organization: the person who added it, or its owners and admins
   */
  async function renameProject(userId, projectId, name, space = personalSpace(userId)) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new AppError("Project name is required.", 400, "VALIDATION_ERROR");
    }

    const cleanName = name.trim();

    if (cleanName.length > MAX_NAME_LENGTH) {
      throw new AppError(
        `Project name must be ${MAX_NAME_LENGTH} characters or fewer.`,
        400,
        "VALIDATION_ERROR"
      );
    }

    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    const project = await findProject(db, space, uid, pid, { need: "manage" });

    if (sameName(project.name, cleanName)) {
      throw new AppError(
        "New name must be different from the current name.",
        400,
        "NAME_UNCHANGED"
      );
    }

    // Case-insensitive match among the space's OTHER projects
    const duplicate = await projectCol.findOne(
      { ...sameSpace(space, uid), name: cleanName, _id: { $ne: pid } },
      { collation: { locale: "en", strength: 2 } }
    );

    if (duplicate) {
      throw new AppError(
        "Project with same name already exists",
        409,
        "PROJECT_NAME_EXISTS"
      );
    }

    const updatedAt = new Date();

    await projectCol.updateOne(
      { _id: pid },
      { $set: { name: cleanName, updatedAt } }
    );

    log.info(
      { userId: uid, projectId: pid, from: project.name, to: cleanName },
      "Project renamed"
    );

    return { ...project, name: cleanName, updatedAt };
  }

  /**
   * Delete project and the data that belongs to it
   * - ownership is checked BEFORE anything is deleted (in an organization:
   *   the person who added it, or its owners and admins)
   */
  async function deleteProject(userId, projectId, space = personalSpace(userId)) {
    if (!ObjectId.isValid(projectId)) {
      throw new AppError("Invalid project id.", 400, "INVALID_ID");
    }

    const uid = toObjectId(userId);
    const pid = toObjectId(projectId);

    // Scoped to what you may manage, so another user's project id can't delete anything
    await findProject(db, space, uid, pid, { need: "manage" });
    const result = await projectCol.deleteOne({ _id: pid });

    if (result.deletedCount === 0) {
      throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
    }

    const { deletedCount: bridgesDeleted } = await bridgeCol.deleteMany({
      projectId: pid,
    });

    // Every person's count on it (each has their own)
    await db.collection("bridge_counters").deleteMany({ projectId: pid });

    // Clear every active-project pointer that referenced this project (an organization's is each member's own)
    await executionCol.updateMany(
      { activeProjectId: pid },
      { $set: { activeProjectId: null, updatedAt: new Date() } }
    );
    if (space.kind === "org") {
      await executionCol.updateMany(
        { [`activeBySpace.${space.id}`]: pid },
        { $unset: { [`activeBySpace.${space.id}`]: "" }, $set: { updatedAt: new Date() } }
      );
    }

    log.info({ userId: uid, projectId: pid, bridgesDeleted }, "Project deleted");

    return { bridgesDeleted };
  }

  /**
   * Which departments see an organization's project (none: every member).
   * The person who added it, or the organization's owners and admins.
   */
  async function setProjectDepartments(userId, projectId, departmentIds, space) {
    if (space?.kind !== "org") throw new AppError("Only an organization's projects have departments.", 400, "NOT_ORG_PROJECT");
    const project = await findProject(db, space, userId, projectId, { need: "manage" });
    const ids = await departmentsFor(space, departmentIds ?? []);
    await projectCol.updateOne({ _id: project._id }, { $set: { departmentIds: ids, updatedAt: new Date() } });
    return { departmentIds: ids };
  }

  return {
    setProjectDepartments,
    listProjects,
    createProject,
    getProjectContents,
    createProjectFromGithub,
    renameProject,
    deleteProject,
  };
}