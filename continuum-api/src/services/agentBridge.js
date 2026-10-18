// src/services/agentBridge.js
//
// An agent interval's bridge: the brain works its session goals. It may break
// a goal into tasks (each given to a worker), reviews the work, gives each goal
// a verdict and, once every goal has one, finishes the interval (the bridge is
// saved). These are the rules, as plain functions on a bridge document: each
// returns the fields to $set, or throws an AgentBridgeError (status + message).
//
//   interval.kind        "human" (missing on older bridges) | "agent"
//   goal.tasks           [{ id, text, agentId, state: planned|working|done|failed, note }]
//   goal.verification    { verdict: completed|incomplete, note, at }

import crypto from "crypto";

export const TASK_STATES = ["planned", "working", "done", "failed"];
export const VERDICTS = ["completed", "incomplete"];
const MAX_TASKS = 12;
const MAX_TEXT = 600;
const MAX_NOTE = 2000;

export class AgentBridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const kindOf = (bridge) => (bridge?.interval?.kind === "agent" ? "agent" : "human");

/** Only a running agent interval may be worked by the brain. */
export function assertAgentDraft(bridge) {
  if (!bridge) throw new AgentBridgeError(404, "No such bridge.");
  if (kindOf(bridge) !== "agent") throw new AgentBridgeError(409, "This is a human interval: its goals are the person's to mark.");
  if (bridge.status !== "draft") throw new AgentBridgeError(409, "This interval has already ended.");
}

const text = (v, max, what) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new AgentBridgeError(400, `${what} can't be empty.`);
  if (s.length > max) throw new AgentBridgeError(400, `${what} is longer than ${max} characters.`);
  return s;
};
const note = (v) => (v == null || v === "" ? null : text(v, MAX_NOTE, "The note"));

function goalAt(bridge, goalId) {
  const goals = bridge.sessionGoals ?? [];
  // Goal ids as the UI and the brain see them: their own, or g1, g2… by position
  const i = goals.findIndex((g, n) => String(g.id ?? `g${n + 1}`) === String(goalId));
  if (i < 0) throw new AgentBridgeError(404, "No such goal in this interval.");
  return i;
}

function withGoal(bridge, goalId, change) {
  assertAgentDraft(bridge);
  const i = goalAt(bridge, goalId);
  const goals = bridge.sessionGoals.map((g, n) => (n === i ? change(g) : g));
  return { sessionGoals: goals, updatedAt: new Date() };
}

/** The brain's breakdown of a goal into tasks (replaces any earlier plan for it; a task's worker and state are kept by id). */
export function planGoal(bridge, goalId, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new AgentBridgeError(400, "Give the goal at least one task.");
  if (tasks.length > MAX_TASKS) throw new AgentBridgeError(400, `At most ${MAX_TASKS} tasks per goal.`);
  return withGoal(bridge, goalId, (g) => {
    if (g.verification) throw new AgentBridgeError(409, "This goal already has its verdict.");
    const before = new Map((g.tasks ?? []).map((t) => [t.id, t]));
    return {
      ...g,
      tasks: tasks.map((t) => {
        const id = typeof t?.id === "string" && /^[\w.-]{1,40}$/.test(t.id) ? t.id : crypto.randomUUID().slice(0, 8);
        const was = before.get(id);
        return { id, text: text(t?.text, MAX_TEXT, "A task"), agentId: was?.agentId ?? null, state: was?.state ?? "planned", note: was?.note ?? null };
      }),
    };
  });
}

/** A task given to a worker, its state, or a note from the brain. */
export function updateTask(bridge, goalId, taskId, patch = {}) {
  return withGoal(bridge, goalId, (g) => {
    const tasks = g.tasks ?? [];
    const j = tasks.findIndex((t) => t.id === taskId);
    if (j < 0) throw new AgentBridgeError(404, "No such task on this goal.");
    const t = { ...tasks[j] };
    if ("agentId" in patch) {
      if (patch.agentId !== null && !/^[a-f0-9]{24}$/.test(String(patch.agentId))) throw new AgentBridgeError(400, "agentId must be an agent ID.");
      t.agentId = patch.agentId;
    }
    if ("state" in patch) {
      if (!TASK_STATES.includes(patch.state)) throw new AgentBridgeError(400, `state is one of ${TASK_STATES.join(", ")}.`);
      t.state = patch.state;
    }
    if ("note" in patch) t.note = note(patch.note);
    return { ...g, tasks: tasks.map((x, n) => (n === j ? t : x)) };
  });
}

/** The brain's verdict on a goal after reviewing the work: its status follows (completed or incomplete). */
export function giveVerdict(bridge, goalId, { verdict, note: why } = {}) {
  if (!VERDICTS.includes(verdict)) throw new AgentBridgeError(400, `verdict is one of ${VERDICTS.join(", ")}.`);
  return withGoal(bridge, goalId, (g) => ({ ...g, status: verdict, verification: { verdict, note: note(why), at: new Date() } }));
}

/**
 * The interval ends: only once every goal has its verdict. The bridge is saved
 * (finalized) with each goal's workers recorded as its agents.
 * by: "brain" (it finished the work) or "person" (stopped from the agent bridge;
 * goals without a verdict stay as they are).
 */
export function finish(bridge, { by = "brain", agentNames = {} } = {}) {
  assertAgentDraft(bridge);
  const goals = bridge.sessionGoals ?? [];
  if (by === "brain") {
    const open = goals.filter((g) => !g.verification);
    if (open.length) throw new AgentBridgeError(409, `${open.length} goal${open.length > 1 ? "s have" : " has"} no verdict yet.`);
  }
  const now = new Date();
  return {
    status: "finalized",
    "interval.endedAt": now,
    "interval.endedBy": by,
    sessionGoals: goals.map((g) => ({
      ...g,
      agents: (g.tasks ?? []).filter((t) => t.agentId).map((t) => ({ agentId: t.agentId, name: agentNames[t.agentId] ?? `worker ${t.agentId.slice(-4)}`, task: t.text, branch: null, state: t.state, error: t.state === "failed" ? t.note : null })),
    })),
    updatedAt: now,
  };
}
