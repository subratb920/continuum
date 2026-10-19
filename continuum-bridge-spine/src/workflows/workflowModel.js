import { createContext, useContext } from "react";

/** The Workflows screen's shared state (WorkflowsProvider). */
export const WorkflowsContext = createContext(null);
export const useWorkflows = () => useContext(WorkflowsContext);

/** Each step kind's icon and name. */
export const KIND = {
  task: { icon: "⚒", label: "Worker task" },
  approval: { icon: "✋", label: "Your approval" },
  review: { icon: "✦", label: "Brain review" },
  final: { icon: "⛙", label: "Final review and merge" },
};

/** A new step of a kind, placed at (x, y). */
export function newStep(kind, steps, x = 120, y = 120) {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `s${n}`)) n++;
  return { id: `s${n}`, kind, title: KIND[kind].label === "Worker task" ? "New task" : KIND[kind].label, instructions: "", scope: [], check: "", goalId: null, x, y, state: "waiting", agentId: null, note: null };
}
