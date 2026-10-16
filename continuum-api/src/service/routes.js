// src/service/routes.js
//
// Read-only data for continuum-brain, server to server (never public), always
// for one user: Authorization: Bearer CONTINUUM_SERVICE_TOKEN and
// X-Continuum-User. The brain reads Continuum only through these, never from
// Continuum's database. Nothing here changes anything.
//   GET /service/projects               the user's projects (id, name, GitHub repo, bridges)
//   GET /service/projects/:id           one of them
//   GET /service/projects/:id/bridges   its bridges, oldest first (interval and goals)
//   GET /service/bridges/:id            one bridge (and its project), if its project is the user's
//   GET /service/interval               the active project and its current bridge, if any
//   GET /service/github                 the user's GitHub sign-in and name for commits:
//                                       only while one of their agents starts (sealed by
//                                       the brain until it has cloned, then dropped)

import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { githubTokenOf } from "../create/github.js";
import { repoOf } from "../workspaces/routes.js";

/** The same value, compared in constant time (so the token can't be guessed byte by byte). */
export function sameSecret(given, expected) {
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b) && String(given).length === String(expected).length;
}

export function projectView(p) {
  return {
    id: String(p._id),
    name: p.name,
    source: p.source ?? "local",
    repo: repoOf(p),
    bridgeCount: p.bridgeCount ?? 0,
    createdAt: p.createdAt ?? null,
  };
}

export function bridgeView(b) {
  return {
    id: String(b._id),
    // Older bridges have no bridgeName: their name, else bridge-<index> (as the UI shows them)
    name: b.bridgeName ?? b.name ?? `bridge-${b.index ?? "?"}`,
    index: b.index,
    status: b.status,
    interval: { mode: b.interval?.mode ?? null, minutes: b.interval?.duration ?? null, startedAt: b.interval?.startedAt ?? null },
    // Goal ids as the UI gives them (utils/normalizeBridge.js): their own, or g1, g2… by position
    goals: (b.sessionGoals ?? []).map((g, i) => ({ id: String(g.id ?? `g${i + 1}`), text: g.text, status: g.status ?? null })),
    ticketUrl: b.ticketUrl ?? null,
    createdAt: b.createdAt ?? null,
  };
}

export function createServiceRouter(opts = {}) {
  const router = express.Router();
  const db = () => opts.db ?? getDB();

  router.use((req, res, next) => {
    const expected = opts.token ?? process.env.CONTINUUM_SERVICE_TOKEN;
    if (!expected) return res.status(503).json({ error: "The brain's access isn't set up here." });
    const header = req.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !sameSecret(given, expected)) return res.status(401).json({ error: "Not allowed." });
    const user = req.get("x-continuum-user") ?? "";
    if (!/^[a-f0-9]{24}$/.test(user)) return res.status(400).json({ error: "X-Continuum-User must be a user ID." });
    req.serviceUser = new ObjectId(user);
    res.set("Cache-Control", "no-store");
    next();
  });

  async function ownProject(req) {
    if (!ObjectId.isValid(req.params.id) || !/^[a-f0-9]{24}$/.test(req.params.id)) return null;
    return db().collection(PROJECT_COLLECTION).findOne({ _id: new ObjectId(req.params.id), userId: req.serviceUser }, { projection: { "contents.entries": 0 } });
  }

  router.get("/projects", async (req, res) => {
    const list = await db().collection(PROJECT_COLLECTION).find({ userId: req.serviceUser }, { projection: { "contents.entries": 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
    res.json(list.map(projectView));
  });

  router.get("/projects/:id", async (req, res) => {
    const p = await ownProject(req);
    if (!p) return res.status(404).json({ error: "No such project." });
    res.json(projectView(p));
  });

  router.get("/projects/:id/bridges", async (req, res) => {
    const p = await ownProject(req);
    if (!p) return res.status(404).json({ error: "No such project." });
    const bridges = await db().collection(BRIDGE_COLLECTION).find({ projectId: p._id }).sort({ index: 1 }).limit(500).toArray();
    res.json(bridges.map(bridgeView));
  });

  router.get("/bridges/:id", async (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: "No such bridge." });
    const bridge = await db().collection(BRIDGE_COLLECTION).findOne({ _id: new ObjectId(req.params.id) });
    const project = bridge ? await db().collection(PROJECT_COLLECTION).findOne({ _id: bridge.projectId, userId: req.serviceUser }, { projection: { _id: 1 } }) : null;
    if (!project) return res.status(404).json({ error: "No such bridge." });
    res.json({ ...bridgeView(bridge), projectId: String(project._id) });
  });

  router.get("/interval", async (req, res) => {
    const state = await db().collection(EXECUTION_COLLECTION).findOne({ userId: req.serviceUser });
    const project = state?.activeProjectId ? await db().collection(PROJECT_COLLECTION).findOne({ _id: state.activeProjectId, userId: req.serviceUser }, { projection: { "contents.entries": 0 } }) : null;
    const bridge = project ? await db().collection(BRIDGE_COLLECTION).findOne({ projectId: project._id, status: "draft" }, { sort: { createdAt: -1 } }) : null;
    res.json({ activeProject: project ? projectView(project) : null, bridge: bridge ? bridgeView(bridge) : null });
  });

  router.get("/github", async (req, res) => {
    const token = await githubTokenOf(db(), String(req.serviceUser));
    const user = await db().collection("users").findOne({ _id: req.serviceUser }, { projection: { name: 1, email: 1 } });
    res.json({ token: token || null, author: user?.email ? { name: user.name || user.email.split("@")[0], email: user.email } : null });
  });

  return router;
}
