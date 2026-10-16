import { useSyncExternalStore } from "react";

/**
 * The running interval, as the brain sees it: { bridgeId, goals: [{ id, text }] }
 * or null. App sets it (from the active bridge); the brain plans from it, and
 * the Agents screen offers its goals when you start a worker.
 */
let current = null;
const listeners = new Set();

export function setRunningInterval(next) {
  current = next;
  listeners.forEach((fn) => fn());
}

export function getRunningInterval() {
  return current;
}

export function useRunningInterval() {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => current
  );
}
