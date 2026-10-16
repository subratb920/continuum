import { createMockBrainClient } from "./mockBrainClient";
import { createSseBrainClient } from "./sseBrainClient";

/**
 * The brain the UI talks to: VITE_BRAIN_MODE=live → brain-api (sseBrainClient),
 * anything else → the pretend one (mockBrainClient). One per page load, so the
 * agents carry on while you switch screens.
 */
let client = null;

export function getBrainClient() {
  client ??= import.meta.env.VITE_BRAIN_MODE === "live" ? createSseBrainClient() : createMockBrainClient();
  return client;
}

export const BRAIN_IS_MOCK = import.meta.env.VITE_BRAIN_MODE !== "live";
