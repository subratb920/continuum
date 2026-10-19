// src/workspaces/routes.js
//
// Continuum Workspaces (signed-in users): a development server per project
// with a GitHub repository, run by continuum-workspaces.
//   GET    /workspaces            the user's workspaces, with their live state
//   POST   /workspaces            { projectId, size, sandbox } → a new (stopped) workspace
//   POST   /workspaces/:id/open   { size?, sandbox? } → { url }: starts it when stopped
//   POST   /workspaces/:id/stop   the code stays; the editor goes
//   DELETE /workspaces/:id        the workspace and its code (GitHub is untouched)
// One workspace per project (for every project the user has), 1 running at a time.

import express from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { githubTokenOf } from "../create/github.js";
import { workspacesClient, WorkspacesUnavailableError } from "./client.js";

export const WORKSPACES_COLLECTION = "workspaces";
export const SIZES = ["small", "standard", "large"];
/** The tools a workspace starts with: "full" has them all; the others only where the service has their images. */
export const SANDBOXES = ["full", "node", "python", "java"];
export const MAX_RUNNING = 1;

const sandboxError = () => Object.assign(new AppError("Choose a sandbox this Continuum offers.", 400, "VALIDATION_ERROR"), { field: "sandbox" });

/** owner/name of a project's GitHub repository (imported, or created with one), or null. */
export function repoOf(project) {
  if (project?.fullName && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.fullName)) return project.fullName;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(project?.githubRepoUrl ?? "");
  return m ? m[1] : null;
}

/**
 * WORKSPACES_URL: the service's internal address; WORKSPACES_PUBLIC_URL: where
 * browsers reach the editors (e.g. https://workspaces.continuum-console.one).
 * Read when first used, so the environment is loaded by then.
 */
export function createWorkspacesRouter(opts = {}) {
  const router = express.Router();
  let client = opts.client ?? null;
  let publicUrl = opts.publicUrl ?? null;

  router.use((_req, _res, next) => {
    client ??= process.env.WORKSPACES_URL ? workspacesClient(process.env.WORKSPACES_URL) : null;
    publicUrl ??= process.env.WORKSPACES_PUBLIC_URL ?? "";
    if (!client) return next(new AppError("Workspaces aren't set up here.", 503, "WORKSPACES_UNAVAILABLE"));
    next();
  });

  const col = () => getDB().collection(WORKSPACES_COLLECTION);
  const uid = (req) => new ObjectId(req.user.id);
  const view = (w, live) => ({
    id: String(w._id),
    projectId: String(w.projectId),
    projectName: w.projectName,
    repo: w.repo,
    size: w.size,
    sandbox: w.sandbox ?? "full",
    state: live?.state ?? "unknown",
    createdAt: w.createdAt,
    lastOpenedAt: w.lastOpenedAt ?? null,
  });

  async function mine(req) {
    if (!ObjectId.isValid(req.params.id)) throw new AppError("Not a workspace.", 404, "NOT_FOUND");
    const w = await col().findOne({ _id: new ObjectId(req.params.id), userId: uid(req) });
    if (!w) throw new AppError("Not a workspace.", 404, "NOT_FOUND");
    return w;
  }

  async function live(id) {
    try {
      const r = await client.status(String(id));
      return r.status === 200 ? r.data : null;
    } catch (e) {
      if (e instanceof WorkspacesUnavailableError) return null;
      throw e;
    }
  }

  /** The sandboxes the service can start now ("full" when it can't say). */
  async function sandboxes() {
    if (!client.sandboxes) return ["full"];
    try {
      const r = await client.sandboxes();
      return r.status === 200 && Array.isArray(r.data?.sandboxes) ? SANDBOXES.filter((s) => r.data.sandboxes.includes(s)) : ["full"];
    } catch (e) {
      if (e instanceof WorkspacesUnavailableError) return ["full"];
      throw e;
    }
  }

  router.get("/", async (req, res) => {
    const list = await col().find({ userId: uid(req) }).sort({ createdAt: 1 }).toArray();
    const [states, offered] = await Promise.all([Promise.all(list.map((w) => live(w._id))), sandboxes()]);
    res.json({ items: list.map((w, i) => view(w, states[i])), limits: { running: MAX_RUNNING }, sizes: SIZES, sandboxes: offered });
  });

  router.post("/", async (req, res) => {
    const { projectId } = req.body ?? {};
    const size = req.body?.size ?? "standard";
    const sandbox = req.body?.sandbox ?? "full";
    if (!SIZES.includes(size)) throw Object.assign(new AppError("Choose Small, Standard or Large.", 400, "VALIDATION_ERROR"), { field: "size" });
    if (!(await sandboxes()).includes(sandbox)) throw sandboxError();
    if (!ObjectId.isValid(projectId)) throw Object.assign(new AppError("Choose a project.", 400, "VALIDATION_ERROR"), { field: "projectId" });
    const project = await getDB().collection(PROJECT_COLLECTION).findOne({ _id: new ObjectId(projectId), userId: uid(req) });
    if (!project) throw Object.assign(new AppError("Choose one of your projects.", 404, "NOT_FOUND"), { field: "projectId" });
    const repo = repoOf(project);
    if (!repo) throw Object.assign(new AppError("A workspace opens a project's GitHub repository: put this project on GitHub first.", 400, "NO_REPOSITORY"), { field: "projectId" });

    const existing = await col().findOne({ userId: uid(req), projectId: project._id });
    if (existing) return void res.json(view(existing, await live(existing._id)));
    const doc = { _id: new ObjectId(), userId: uid(req), projectId: project._id, projectName: project.name, repo, size, sandbox, createdAt: new Date(), lastOpenedAt: null };
    await col().insertOne(doc);
    req.log.info({ workspace: String(doc._id), repo, size, sandbox }, "Workspace created");
    res.status(201).json(view(doc, { state: "stopped" }));
  });

  router.post("/:id/open", async (req, res) => {
    const w = await mine(req);
    const id = String(w._id);
    // Running: its current way in; otherwise it starts (one running at a time)
    let opened = await client.open(id);
    if (opened.status !== 200) {
      const size = req.body?.size ?? w.size;
      const sandbox = req.body?.sandbox ?? w.sandbox ?? "full";
      if (!SIZES.includes(size)) throw Object.assign(new AppError("Choose Small, Standard or Large.", 400, "VALIDATION_ERROR"), { field: "size" });
      if (!(await sandboxes()).includes(sandbox)) throw sandboxError();
      const others = (await col().find({ userId: uid(req), _id: { $ne: w._id } }).toArray()).map((x) => x._id);
      const running = (await Promise.all(others.map(live))).filter((s) => s && s.state !== "stopped").length;
      if (running >= MAX_RUNNING) throw new AppError("Another workspace is running; stop it first (one runs at a time).", 409, "LIMIT_REACHED");

      const token = await githubTokenOf(getDB(), req.user.id);
      if (!token) throw new AppError("Connect GitHub to open a workspace (it works on your repository): Profile → Settings → Integrations.", 400, "GITHUB_NOT_CONNECTED");
      const user = await getDB().collection("users").findOne({ _id: uid(req) }, { projection: { email: 1, name: 1 } });
      opened = await client.start(id, { repo: w.repo, githubToken: token, size, sandbox, author: { name: user?.name, email: user?.email } });
      if (opened.status !== 202) throw new AppError(opened.data?.error ?? "The workspace couldn't start.", opened.status >= 500 ? 502 : opened.status, "WORKSPACE_FAILED");
      if (size !== w.size || sandbox !== w.sandbox) await col().updateOne({ _id: w._id }, { $set: { size, sandbox } });
      req.log.info({ workspace: id, size, sandbox }, "Workspace started");
    }
    await col().updateOne({ _id: w._id }, { $set: { lastOpenedAt: new Date() } });
    res.json({ id, state: opened.data.state, url: `${publicUrl.replace(/\/+$/, "")}${opened.data.path}` });
  });

  router.post("/:id/stop", async (req, res) => {
    const w = await mine(req);
    const r = await client.stop(String(w._id));
    if (r.status !== 200) throw new AppError(r.data?.error ?? "The workspace couldn't be stopped.", 502, "WORKSPACE_FAILED");
    res.json(view(w, { state: "stopped" }));
  });

  router.delete("/:id", async (req, res) => {
    const w = await mine(req);
    const r = await client.remove(String(w._id));
    if (r.status !== 200) throw new AppError(r.data?.error ?? "The workspace couldn't be deleted.", 502, "WORKSPACE_FAILED");
    await col().deleteOne({ _id: w._id });
    req.log.info({ workspace: String(w._id) }, "Workspace deleted");
    res.status(204).end();
  });

  // The service being down is a clear 503, not a crash
  router.use((err, _req, _res, next) => next(err instanceof WorkspacesUnavailableError ? new AppError(err.message, 503, "WORKSPACES_UNAVAILABLE") : err));

  return router;
}
