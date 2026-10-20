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
    line: "A worker fixes the failing tests; they fail again twice before they pass. Each try starts from what failed.",
    frames: [
      f({ core: ["working", "Reading the goal: make the tests pass"] }),
      f({ core: ["working", "Starting a worker", "spawn_agent"], w1: ["starting", "Fix the failing tests"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "npm test ✗ 5 failing"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "read src/cart.js"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Fix the failing tests", "edit src/cart.js", true] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Try 1", "npm test ✗ 2 failing"] }),
      f({ core: ["working", "Not yet: sending it back", "message_agent"], w1: ["working", "Try 2: rounding in totals"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Try 2: rounding in totals", "edit src/money.js"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Try 2", "npm test ✗ 1 failing"] }),
      f({ core: ["working", "Not yet: the empty cart", "message_agent"], w1: ["working", "Try 3: the empty cart"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Try 3: the empty cart", "edit src/cart.js"] }),
      f({ core: ["idle", "Waiting for its worker"], w1: ["working", "Try 3", "npm test ✓ 48 passing"] }),
      f({ core: ["working", "Reviewing the change", "review_work"], w1: ["idle", "Done after 3 tries: 2 files"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done after 3 tries: 2 files"] }),
    ],
  },
  {
    id: "split",
    title: "Split the work",
    line: "Two workers at once; one asks a question, the brain's review sends the other back once.",
    frames: [
      f({ core: ["working", "Planning two parts", "plan_scopes"] }),
      f({ core: ["working", "Starting two workers", "spawn_agent"], w1: ["starting", "Tests for the API"], w2: ["starting", "Update the README"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "read api/orders.js"], w2: ["working", "Update the README", "read README.md"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "write test/orders.test.js"], w2: ["working", "Update the README", "Which install steps?", true] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Tests for the API", "npm test ✓"], w2: ["working", "Update the README", "edit README.md"] }),
      f({ core: ["working", "Reviewing both", "review_work"], w1: ["idle", "Done: 12 tests"], w2: ["idle", "Done: README"] }),
      f({ core: ["working", "Missing: refunds aren't tested", "message_agent"], w1: ["working", "Try 2: test refunds too"], w2: ["idle", "Done: README"] }),
      f({ core: ["idle", "Waiting for one worker"], w1: ["working", "Try 2: test refunds too", "npm test ✓ 15"], w2: ["idle", "Done: README"] }),
      f({ core: ["working", "Merging both parts", "settle_clashes"], w1: ["stopped", "Done: 15 tests"], w2: ["stopped", "Done: README"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: 15 tests"], w2: ["stopped", "Done: README"] }),
    ],
  },
  {
    id: "plan",
    title: "Plan first",
    line: "The brain drafts a plan; you send it back with a change; it revises, you approve, the work starts.",
    frames: [
      f({ core: ["working", "Reading your project", "read package.json"] }),
      f({ core: ["working", "Drafting a plan", "propose_workflow"] }),
      f({ core: ["working", "Plan ready: approve it?", "request_approval", true] }),
      f({ core: ["working", "You sent it back: split search in two", null, true] }),
      f({ core: ["working", "Revising the plan", "propose_workflow"] }),
      f({ core: ["working", "Plan v2 ready: approve it?", "request_approval", true] }),
      f({ core: ["working", "Approved: starting", "spawn_agent"], w1: ["starting", "Search box"], w2: ["starting", "Search results page"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Search box", "write src/SearchBox.jsx"], w2: ["working", "Search results page", "write src/Results.jsx"] }),
      f({ core: ["idle", "Two workers at work"], w1: ["working", "Search box", "npm run build ✓"], w2: ["working", "Search results page", "npm run build ✓"] }),
      f({ core: ["working", "Reviewing", "review_work"], w1: ["idle", "Done: search box"], w2: ["idle", "Done: results page"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: search box"], w2: ["stopped", "Done: results page"] }),
    ],
  },
  {
    id: "retry",
    title: "Retry and merge",
    line: "Three workers; one fails, the brain tries again with the error, then merges all three.",
    frames: [
      f({ core: ["working", "Starting three workers", "spawn_agent"], w1: ["starting", "Login form"], w2: ["starting", "Password reset"], w3: ["starting", "Email templates"] }),
      f({ core: ["idle", "Three workers at work"], w1: ["working", "Login form", "edit src/Login.jsx"], w2: ["working", "Password reset", "edit api/reset.js"], w3: ["working", "Email templates", "write emails/reset.html"] }),
      f({ core: ["idle", "Three workers at work"], w1: ["working", "Login form", "npm test ✓"], w2: ["failed", "Password reset: tests fail"], w3: ["working", "Email templates", "npm test ✓"] }),
      f({ core: ["working", "Trying again with the error", "wake_worker"], w1: ["idle", "Done: login form"], w2: ["working", "Try 2: password reset", "read the failing test"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for one worker"], w1: ["idle", "Done: login form"], w2: ["working", "Try 2: password reset", "edit api/reset.js"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for one worker"], w1: ["idle", "Done: login form"], w2: ["working", "Try 2: password reset", "npm test ✓"], w3: ["idle", "Done: email templates"] }),
      f({ core: ["working", "Final review and merge", "final_report"], w1: ["stopped", "Done: login form"], w2: ["stopped", "Done: password reset"], w3: ["stopped", "Done: email templates"] }),
      f({ core: ["idle", "Waiting for your next goal"], w1: ["stopped", "Done: login form"], w2: ["stopped", "Done: password reset"], w3: ["stopped", "Done: email templates"] }),
    ],
  },
  {
    id: "mainframe",
    title: "Mainframe load test",
    line: "A COBOL wave on the new platform: the load test misses 100k req/s three times; each try fixes the bottleneck it found.",
    frames: [
      f({ core: ["working", "Equivalence passed: load test next", "spawn_agent"], w1: ["starting", "Load test: 100k req/s"] }),
      f({ core: ["idle", "Waiting for the load test"], w1: ["working", "Load test: 100k req/s", "k6 run peak.js"] }),
      f({ core: ["idle", "Waiting for the load test"], w1: ["failed", "41k req/s, p99 380 ms"] }),
      f({ core: ["working", "Bottleneck: one connection pool", "spawn_agent"], w1: ["stopped", "41k req/s"], w2: ["starting", "Pools per service, batch commits"] }),
      f({ core: ["idle", "Tuning"], w1: ["stopped", "41k req/s"], w2: ["working", "Pools per service, batch commits", "edit ops/infra/db.yaml"] }),
      f({ core: ["idle", "Load test again"], w1: ["working", "Try 2", "k6 run peak.js"], w2: ["idle", "Done: pools"] }),
      f({ core: ["idle", "Load test again"], w1: ["failed", "72k req/s; batch 5 h 40 m"], w2: ["idle", "Done: pools"] }),
      f({ core: ["working", "Bottleneck: batch in sequence", "message_agent"], w1: ["stopped", "72k req/s"], w2: ["working", "Partition the batch by account", "edit jobs/Interest.java"] }),
      f({ core: ["idle", "Load test again"], w1: ["working", "Try 3", "k6 run peak.js"], w2: ["idle", "Done: partitions"] }),
      f({ core: ["idle", "Load test again"], w1: ["failed", "94k req/s, p99 120 ms"], w2: ["idle", "Done: partitions"] }),
      f({ core: ["working", "Bottleneck: lookups uncached", "message_agent"], w1: ["stopped", "94k req/s"], w2: ["working", "Cache account lookups", "edit app/cache/"] }),
      f({ core: ["idle", "Load test again"], w1: ["working", "Try 4", "k6 run peak.js"], w2: ["idle", "Done: cache"] }),
      f({ core: ["working", "Passed: 112k req/s, p99 31 ms, batch 3 h 10 m", "complete_step"], w1: ["idle", "112k req/s ✓"], w2: ["stopped", "Done: cache"] }),
      f({ core: ["idle", "Next: parallel run with the mainframe"], w1: ["stopped", "112k req/s ✓"], w2: ["stopped", "Done: cache"] }),
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
