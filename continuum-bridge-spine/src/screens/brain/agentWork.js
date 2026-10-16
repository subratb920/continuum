import { workersOnGoal } from "../../brain/brainContext";
import { agentName } from "./agentDisplay";

/** What the workers did on each goal, in the goal's own record (kept with the Bridge). */
export function agentWork(workers, bridgeId, goalId) {
  return workersOnGoal(workers, bridgeId, goalId).map((w) => ({
    agentId: w._id,
    name: agentName(w, workers),
    task: w.task,
    branch: w.branch,
    state: w.state,
    error: w.error?.message ?? null,
  }));
}

/** The bridge with each goal's agent work recorded (goals without agents keep theirs). */
export function withAgentWork(bridge, workers) {
  if (!workers?.length) return bridge;
  return {
    ...bridge,
    sessionGoals: bridge.sessionGoals.map((g) => {
      const work = agentWork(workers, bridge._id, g.id);
      return work.length ? { ...g, agents: work } : g;
    }),
  };
}
