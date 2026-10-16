import { createContext, useContext } from "react";

/** The brain's live state and actions (BrainProvider fills it). */
export const BrainContext = createContext(null);

/** The brain's state and actions; null outside a BrainProvider. */
export function useBrain() {
  return useContext(BrainContext);
}

/** How many permissions and questions wait on you (the switcher's badge). */
export function usePendingCount() {
  return useContext(BrainContext)?.pending.length ?? 0;
}

/** An agent's latest event of some kinds (e.g. its last tool call). */
export function lastEvent(events, agentId, kinds) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.agentId === agentId && (!kinds || kinds.includes(e.kind))) return e;
  }
  return null;
}
