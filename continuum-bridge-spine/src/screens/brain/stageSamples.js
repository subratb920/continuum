import { useEffect, useState } from "react";

/**
 * Sample runs for the Agent Stage: what a brain and its workers look like at
 * work, played in the page (nothing starts, nothing is saved). Shown while
 * your own brain has no workers on the stage. Each sample is a loop of
 * frames: who is there, in what state, waiting on you or not, and the tool
 * call each one is making.
 */
const FRAME_MS = 1700;

// A frame: { id: [state, task, tool?, asking?] }; "core" is the brain
const f = (agents) => agents;

export const STAGE_SAMPLES = [
  {
    id: "fix",
    title: "One fix",
    line: "A worker finds the failing test, asks before its change, fixes it.",
    frames: [
      f({ core: ["working", "Reading the goal: make the tests pass"] }),
      f({ core: ["working", "Starting a worker", "spawn_agent"], w1: ["starting", "Fix the failing tests"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "npm test"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "read src/cart.js"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "edit src/cart.js", true] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "edit src/cart.js"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "npm test ✓"] }),
      f({ core: ["working", "Reviewing the change", "review_work"], w1: ["idle", "Done: 1 file changed"] }),
      f({ core: ["working", "Goal met", "complete_goal"], w1: ["stopped", "Done: 1 file changed"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: 1 file changed"] }),
    ],
  },
  {
    id: "split",
    title: "Split the work",
    line: "Two workers at once, each on its own part; one asks a question.",
    frames: [
      f({ core: ["working", "Planning two parts", "plan_scopes"] }),
      f({ core: ["working", "Starting two workers", "spawn_agent"], w1: ["starting", "Tests for the API"], w2: ["starting", "Update the README"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "read api/orders.js"], w2: ["working", "Update the README", "read README.md"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "write test/orders.test.js"], w2: ["working", "Update the README", "Which install steps?", true] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "npm test"], w2: ["working", "Update the README", "edit README.md"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "npm test ✓"], w2: ["idle", "Done: README updated"] }),
      f({ core: ["working", "Reviewing both", "review_work"], w1: ["idle", "Done: 12 tests added"], w2: ["idle", "Done: README updated"] }),
      f({ core: ["working", "Merging both parts", "settle_clashes"], w1: ["stopped", "Done: 12 tests added"], w2: ["stopped", "Done: README updated"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: 12 tests added"], w2: ["stopped", "Done: README updated"] }),
    ],
  },
  {
    id: "plan",
    title: "Plan first",
    line: "The brain asks you first, then starts the work you agreed.",
    frames: [
      f({ core: ["working", "Reading your project", "read package.json"] }),
      f({ core: ["working", "Drafting a plan", "propose_workflow"] }),
      f({ core: ["working", "Plan ready: approve it?", "request_approval", true] }),
      f({ core: ["working", "Plan ready: approve it?", null, true] }),
      f({ core: ["working", "Approved: starting", "spawn_agent"], w1: ["starting", "Add the search page"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Add the search page", "write src/Search.jsx"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Add the search page", "npm run build ✓"] }),
      f({ core: ["working", "Reviewing", "review_work"], w1: ["idle", "Done: search page added"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: search page added"] }),
    ],
  },
  {
    id: "retry",
    title: "Retry and merge",
    line: "Three workers; one fails, the brain tries again, then merges all three.",
    frames: [
      f({ core: ["working", "Starting three workers", "spawn_agent"], w1: ["starting", "Login form"], w2: ["starting", "Password reset"], w3: ["starting", "Email templates"] }),
      f({ core: ["idle", "Three workers at work"], w1: ["working", "Login form", "edit src/Login.jsx"], w2: ["working", "Password reset", "edit api/reset.js"], w3: ["working", "Email templates", "write emails/reset.html"] }),
      f({ core: ["idle", "Three workers at work"], w1: ["working", "Login form", "npm test ✓"], w2: ["failed", "Password reset: tests fail"], w3: ["working", "Email templates", "npm test ✓"] }),
      f({ core: ["working", "Trying again with the error", "wake_worker"], w1: ["idle", "Done: login form"], w2: ["working", "Password reset", "read the failing test"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for one worker"], w1: ["idle", "Done: login form"], w2: ["working", "Password reset", "edit api/reset.js"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for one worker"], w1: ["idle", "Done: login form"], w2: ["working", "Password reset", "npm test ✓"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["working", "Final review and merge", "final_report"], w1: ["stopped", "Done: login form"], w2: ["stopped", "Done: password reset"], w3: ["stopped", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: login form"], w2: ["stopped", "Done: password reset"], w3: ["stopped", "Done: email templates"] }),
    ],
  },
];

/**
 * A sample playing: the stage's view of it now ({ core, workers, events,
 * pending }, shaped like the brain's), looping. null: no sample.
 */
export function useStageSample(id) {
  const sample = STAGE_SAMPLES.find((s) => s.id === id) ?? null;
  // Each frame: its number and when it began (a moment ago: the stage shows a tool call from its own clock, which ticks every half second)
  const [{ n: tick, at: began }, setTick] = useState(() => ({ n: 0, at: Date.now() - 1000 }));
  useEffect(() => {
    if (!sample) return undefined;
    const t = setInterval(() => setTick((x) => ({ n: x.n + 1, at: Date.now() - 1000 })), FRAME_MS);
    return () => clearInterval(t);
  }, [sample]);
  if (!sample) return null;

  const i = tick % (sample.frames.length + 2); // two frames' rest at the end
  const frame = sample.frames[Math.min(i, sample.frames.length - 1)];
  const at = new Date(began).toISOString();
  const agents = Object.entries(frame).map(([key, [state, task, tool, asking]]) => ({
    _id: `sample-${sample.id}-${key}`,
    kind: key === "core" ? "core" : "worker",
    state,
    task,
    tool: tool ?? null,
    asking: !!asking,
  }));
  return {
    sample,
    core: agents.find((a) => a.kind === "core") ?? null,
    workers: agents.filter((a) => a.kind === "worker"),
    // A tool call per agent, new each frame (so it floats up again)
    events: agents.filter((a) => a.tool && a.state === "working").map((a) => ({ _id: `${a._id}-${tick}`, agentId: a._id, kind: "tool", at, text: a.tool })),
    pending: agents.filter((a) => a.asking).map((a) => ({ _id: `${a._id}-ask`, agentId: a._id })),
  };
}
