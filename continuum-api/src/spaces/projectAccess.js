// src/spaces/projectAccess.js
//
// Spaces: where you work. Your personal space ("u:<your id>") and each
// organization you're in ("o:<org id>"), switched like GitHub's. A request
// says which with the X-Continuum-Space header (none: personal); the
// directory (continuum-directory) says whether you're in it, with your
// organization role and departments.
//
// An organization's roles (owner, admin, member, viewer) are only about that
// organization: who manages it and who sees its projects. They never give a
// Continuum role or feature: an organization's admin isn't Continuum's admin.
//
// Projects stay here (MongoDB). Departments decide which of an organization's
// projects a member or viewer sees: a project in no department is seen by
// every member; owners and admins see them all; whoever added a project
// always sees it. Viewers only look.

import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { AppError } from "../errors/AppError.js";
import { dir } from "../directory/directory.js";

export const SPACE_HEADER = "x-continuum-space";

const HEX = /^[a-f0-9]{24}$/;
const oid = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

export const personalSpaceId = (userId) => `u:${userId}`;

/** Runs the organization (its name, members, departments, invites). */
export const managesOrg = (space) => space?.kind === "org" && (space.orgRole === "owner" || space.orgRole === "admin");
/** May change things here (a viewer only looks). */
export const canWrite = (space) => space?.kind === "user" || (space?.kind === "org" && space.orgRole !== "viewer");

/** Your personal space. */
export const personalSpace = (userId) => ({ id: personalSpaceId(userId), kind: "user" });

/** After authed: req.space (the directory's resolveSpace: personal, or an organization you're in). */
export function withSpace({ resolve = dir.resolveSpace } = {}) {
  return async (req, res, next) => {
    try {
      req.space = await resolve(req.user.id, req.headers[SPACE_HEADER]);
      next();
    } catch (err) {
      if (err?.isOperational) return res.status(err.statusCode ?? 403).json({ error: err.message, code: err.code });
      next(err);
    }
  };
}

/** A personal project: yours, and in no organization (projects from before spaces are personal). */
export function personalProjectFilter(userId) {
  const uid = oid(userId);
  return { userId: uid, $or: [{ spaceId: personalSpaceId(uid) }, { spaceId: { $exists: false } }, { spaceId: null }] };
}

/** The projects you see in this space. */
export function projectFilter(space, userId) {
  if (space?.kind !== "org") return personalProjectFilter(userId);
  if (managesOrg(space)) return { spaceId: space.id };
  return {
    spaceId: space.id,
    // Also the ones you added yourself, whichever departments they're in
    $or: [{ departmentIds: { $in: space.departmentIds ?? [] } }, { departmentIds: { $exists: false } }, { departmentIds: { $size: 0 } }, { userId: oid(userId) }],
  };
}

/** May rename it, delete it, choose its departments: yours, or you run the organization. */
export function canManageProject(space, project, userId) {
  if (!project || !canWrite(space)) return false;
  if (space.kind === "user") return true; // the filter already made it yours
  return managesOrg(space) || Boolean(project.userId && oid(project.userId).equals(oid(userId)));
}

/**
 * A project you can reach in this space, for what you want to do with it:
 * "read" (see it), "write" (work on it: a viewer can't), "manage" (see
 * canManageProject). Not there or not yours to see: 404; seen but not yours
 * to change: 403.
 */
export async function findProject(db, space, userId, projectId, { need = "read", projection } = {}) {
  if (!HEX.test(String(projectId ?? ""))) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
  const project = await (db ?? getDB()).collection(PROJECT_COLLECTION).findOne({ _id: oid(projectId), ...projectFilter(space, userId) }, projection ? { projection } : undefined);
  if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
  if (need === "write" && !canWrite(space)) throw new AppError("You can only look at this organization's projects (you're a viewer).", 403, "READ_ONLY");
  if (need === "manage" && !canManageProject(space, project, userId)) {
    throw new AppError(canWrite(space) ? "Only the person who added this project, or the organization's owners and admins, can change it." : "You can only look at this organization's projects (you're a viewer).", 403, canWrite(space) ? "NOT_YOURS" : "READ_ONLY");
  }
  return project;
}
