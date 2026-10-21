// src/service/routes.js
//
// Data for continuum-brain, server to server (never public), always for one
// user: Authorization: Bearer CONTINUUM_SERVICE_TOKEN and X-Continuum-User.
// The brain reads Continuum only through these, never from Continuum's
// database. It changes only one thing: the bridge of an agent interval (the
// brain works its goals; services/agentBridge.js holds the rules).
//   GET /service/projects               the user's projects (id, name, GitHub repo, bridges)
//   GET /service/projects/:id           one of them
//   GET /service/projects/:id/bridges   its bridges, oldest first (interval and goals)
//   GET /service/bridges/:id            one bridge (and its project), if its project is the user's
//   GET /service/interval               the active project and its current bridge, if any
//   PUT   /service/bridges/:id/goals/:goalId/tasks          { tasks: [{ id?, text }] } a goal broken into tasks
//   PATCH /service/bridges/:id/goals/:goalId/tasks/:taskId  { agentId?, state?, note? } a task's worker and state
//   POST  /service/bridges/:id/goals/:goalId/verdict        { verdict: completed|incomplete, note } after review
//   POST  /service/bridges/:id/finish                       every goal has its verdict: the interval ends, saved
//   GET /service/github                 the user's GitHub sign-in and name for commits:
//                                       only while one of their agents starts (sealed by
//                                       the brain until it has cloned, then dropped)

import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { PROJECT_COLLECTION } from "../models/project.model.js";
import { personalProjectFilter } from "../spaces/projectAccess.js";
import { BRIDGE_COLLECTION } from "../models/bridge.model.js";
import { bridgeFor, mineFilter } from "../services/bridgeAccess.js";
import { EXECUTION_COLLECTION } from "../models/execution.model.js";
import { githubTokenOf } from "../create/github.js";
import { repoOf } from "../workspaces/routes.js";
import { AgentBridgeError, finish, giveVerdict, kindOf, planGoal, updateTask } from "../services/agentBridge.js";

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
    // kind: "human" (a person's, timed) or "agent" (the brain works its goals; no duration)
    interval: { kind: kindOf(b), mode: b.interval?.mode ?? null, minutes: b.interval?.duration ?? null, startedAt: b.interval?.startedAt ?? null, endedAt: b.interval?.endedAt ?? null, workFrom: b.interval?.workFrom ?? "github" },
    // Goal ids as the UI gives them (utils/normalizeBridge.js): their own, or g1, g2… by position
    goals: (b.sessionGoals ?? []).map((g, i) => ({
      id: String(g.id ?? `g${i + 1}`),
      text: g.text,
      status: g.status ?? null,
      tasks: (g.tasks ?? []).map((t) => ({ id: t.id, text: t.text, agentId: t.agentId ?? null, state: t.state, note: t.note ?? null })),
      verification: g.verification ?? null,
    })),
    ticketUrl: b.ticketUrl ?? null,
    createdAt: b.createdAt ?? null,
  };
}

export function createServiceRouter(opts = {}) {
  const router = express.Router();
  const db = () => opts.db ?? getDB();
  // Injected by app.js (the directory's recordVisit); absent in unit tests → /visits is a no-op.
  const recordVisit = opts.recordVisit ?? null;

  // Service token only (no per-user), checked in constant time.
  function requireServiceToken(req, res, next) {
    const expected = opts.token ?? process.env.CONTINUUM_SERVICE_TOKEN;
    if (!expected) return res.status(503).json({ error: "Service access isn't set up here." });
    const header = req.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !sameSecret(given, expected)) return res.status(401).json({ error: "Not allowed." });
    res.set("Cache-Control", "no-store");
    next();
  }

  // Public-site page views, forwarded by continuum-site in batches (server to
  // server; no user). Recorded as anonymous analytics in the Directory. Defined
  // before the per-user guard below, so it needs no X-Continuum-User.
  router.post("/visits", requireServiceToken, async (req, res) => {
    if (!recordVisit) return res.status(503).json({ error: "Visit recording isn't set up here." });
    const items = Array.isArray(req.body?.visits) ? req.body.visits.slice(0, 500) : [];
    let saved = 0;
    for (const v of items) {
      try {
        if (await recordVisit({ ...v, via: "server" })) saved++;
      } catch (err) {
        req.log?.warn?.({ err: err.message }, "Visit not recorded"); // one bad item never fails the batch
      }
    }
    res.json({ saved });
  });

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
    return db().collection(PROJECT_COLLECTION).findOne({ _id: new ObjectId(req.params.id), ...personalProjectFilter(req.serviceUser) }, { projection: { "contents.entries": 0 } });
  }

  router.get("/projects", async (req, res) => {
    const list = await db().collection(PROJECT_COLLECTION).find(personalProjectFilter(req.serviceUser), { projection: { "contents.entries": 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
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
    const bridges = await db().collection(BRIDGE_COLLECTION).find({ projectId: p._id, ...mineFilter(req.serviceUser, true) }).sort({ index: 1 }).limit(500).toArray();
    res.json(bridges.map(bridgeView));
  });

  router.get("/bridges/:id", async (req, res) => {
    const bridge = await ownBridge(req.params.id, req.serviceUser);
    if (!bridge) return res.status(404).json({ error: "No such bridge." });
    res.json({ ...bridgeView(bridge), projectId: String(bridge.projectId) });
  });

  /** The user's own bridge, or null. */
  async function ownBridge(id, user) {
    return bridgeFor(db(), id, user);
  }

  /** Changes an agent interval's bridge by one of agentBridge.js's rules, and answers with it as the brain sees it. */
  const change = (rule) => async (req, res) => {
    const bridge = await ownBridge(req.params.id, req.serviceUser);
    if (!bridge) return res.status(404).json({ error: "No such bridge." });
    let set;
    try {
      set = rule(bridge, req.body ?? {}, req.params);
    } catch (err) {
      if (err instanceof AgentBridgeError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    // Only while it's still the running draft (another change may have ended it)
    const done = await db().collection(BRIDGE_COLLECTION).updateOne({ _id: bridge._id, status: "draft" }, { $set: set });
    if (!done.matchedCount) return res.status(409).json({ error: "This interval has already ended." });
    const after = await db().collection(BRIDGE_COLLECTION).findOne({ _id: bridge._id });
    res.json({ ...bridgeView(after), projectId: String(after.projectId) });
  };

  router.put("/bridges/:id/goals/:goalId/tasks", change((b, body, p) => planGoal(b, p.goalId, body.tasks)));
  router.patch("/bridges/:id/goals/:goalId/tasks/:taskId", change((b, body, p) => updateTask(b, p.goalId, p.taskId, body)));
  router.post("/bridges/:id/goals/:goalId/verdict", change((b, body, p) => giveVerdict(b, p.goalId, body)));
  router.post("/bridges/:id/finish", change((b, body) => finish(b, { by: "brain", agentNames: body.agentNames ?? {} })));

  router.get("/interval", async (req, res) => {
    const state = await db().collection(EXECUTION_COLLECTION).findOne({ userId: req.serviceUser });
    const project = state?.activeProjectId ? await db().collection(PROJECT_COLLECTION).findOne({ _id: state.activeProjectId, ...personalProjectFilter(req.serviceUser) }, { projection: { "contents.entries": 0 } }) : null;
    // The user's own running interval on it (another person's never)
    const bridge = project ? await db().collection(BRIDGE_COLLECTION).findOne({ projectId: project._id, status: "draft", ...mineFilter(req.serviceUser, true) }, { sort: { createdAt: -1 } }) : null;
    res.json({ activeProject: project ? projectView(project) : null, bridge: bridge ? bridgeView(bridge) : null });
  });

  // Only the user's name for commits (work in their folder never touches GitHub)
  router.get("/author", async (req, res) => {
    const user = await db().collection("users").findOne({ _id: req.serviceUser }, { projection: { name: 1, email: 1 } });
    res.json({ author: user?.email ? { name: user.name || user.email.split("@")[0], email: user.email } : null });
  });

  router.get("/github", async (req, res) => {
    const token = await githubTokenOf(db(), String(req.serviceUser));
    const user = await db().collection("users").findOne({ _id: req.serviceUser }, { projection: { name: 1, email: 1 } });
    res.json({ token: token || null, author: user?.email ? { name: user.name || user.email.split("@")[0], email: user.email } : null });
  });

  return router;
}
