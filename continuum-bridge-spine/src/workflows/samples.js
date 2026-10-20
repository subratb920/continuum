import { useEffect, useState } from "react";

/**
 * Sample workflows: ready-made templates to look at, watch run (played in
 * the page: nothing starts, no worker is used) and copy as your own. A run
 * follows the arrows: a step starts when every step before it is done;
 * tasks take a worker each, the brain reviews, your approvals wait a moment
 * (as if you pressed Approve), the final step merges.
 */
const TICK_MS = 1400;
const LASTS = { task: 3, review: 2, approval: 2, final: 2 }; // ticks a step takes (an approval: waiting on you)

const step = (id, kind, title, x, y, more = {}) => ({ id, kind, title, instructions: "", scope: [], check: "", goalId: null, x, y, state: "waiting", agentId: null, note: null, ...more });
const edges = (...pairs) => pairs.map(([from, to]) => ({ from, to }));

export const SAMPLE_WORKFLOWS = [
  {
    id: "sample-feature",
    name: "Feature with tests",
    description: "Back end and front end at once, the brain reviews both, you approve, then it all merges.",
    steps: [
      step("api", "task", "API endpoint", 60, 60, { instructions: "Add the endpoint and its validation.", scope: ["api/"], check: "cd api && npm test" }),
      step("ui", "task", "Page and form", 60, 240, { instructions: "Add the page that calls the endpoint.", scope: ["web/src/"], check: "cd web && npm run build" }),
      step("tests", "task", "End-to-end tests", 340, 150, { instructions: "Cover the new flow end to end.", scope: ["e2e/"], check: "npm run e2e" }),
      step("review", "review", "Brain review", 620, 150, { instructions: "Both halves agree; tests cover the new flow." }),
      step("ok", "approval", "Your approval", 880, 150, { instructions: "Look at the change before it merges." }),
      step("merge", "final", "Merge into your folder", 1140, 150),
    ],
    edges: edges(["api", "tests"], ["ui", "tests"], ["tests", "review"], ["review", "ok"], ["ok", "merge"]),
  },
  {
    id: "sample-bugfix",
    name: "Bug fix",
    description: "Reproduce it with a failing test, fix it, check nothing else broke.",
    steps: [
      step("repro", "task", "Failing test that shows the bug", 60, 150, { instructions: "Write a test that fails the way the bug report says.", scope: ["test/"], check: "npm test (fails)" }),
      step("fix", "task", "Fix", 340, 150, { instructions: "Make the new test pass without changing it.", scope: ["src/"], check: "npm test" }),
      step("review", "review", "Brain review", 620, 150, { instructions: "The fix is the smallest that works; the whole suite passes." }),
      step("merge", "final", "Merge", 880, 150),
    ],
    edges: edges(["repro", "fix"], ["fix", "review"], ["review", "merge"]),
  },
  {
    id: "sample-docs",
    name: "Docs and release notes",
    description: "Three writers at once, a review, and your sign-off.",
    steps: [
      step("readme", "task", "README", 60, 40, { scope: ["README.md"] }),
      step("api-docs", "task", "API docs", 60, 180, { scope: ["docs/api/"] }),
      step("changelog", "task", "Changelog", 60, 320, { scope: ["CHANGELOG.md"] }),
      step("review", "review", "Brain review", 360, 180, { instructions: "Docs match the code; nothing contradicts." }),
      step("ok", "approval", "Your sign-off", 640, 180),
    ],
    edges: edges(["readme", "review"], ["api-docs", "review"], ["changelog", "review"], ["review", "ok"]),
  },
  {
    id: "sample-refactor",
    name: "Refactor in parts",
    description: "Split a refactor into parts that don't share files, check each, then merge them together.",
    steps: [
      step("plan", "review", "Brain plans the parts", 60, 180, { instructions: "Split the work so no two parts touch the same files." }),
      step("p1", "task", "Part 1: data layer", 340, 40, { scope: ["src/data/"], check: "npm test -- data" }),
      step("p2", "task", "Part 2: services", 340, 180, { scope: ["src/services/"], check: "npm test -- services" }),
      step("p3", "task", "Part 3: routes", 340, 320, { scope: ["src/routes/"], check: "npm test -- routes" }),
      step("ok", "approval", "Your approval", 640, 180),
      step("merge", "final", "Merge all parts", 900, 180),
    ],
    edges: edges(["plan", "p1"], ["plan", "p2"], ["plan", "p3"], ["p1", "ok"], ["p2", "ok"], ["p3", "ok"], ["ok", "merge"]),
  },
];

/** A sample's steps after this many ticks of a pretend run (from the start; it loops). */
export function simulate(sample, ticks) {
  const steps = sample.steps.map((s) => ({ ...s, state: "waiting", worker: null, left: LASTS[s.kind] }));
  const before = (id) => sample.edges.filter((e) => e.to === id).map((e) => e.from);
  let workers = 0;
  for (let t = 0; t < ticks; t++) {
    // What's working moves on; what's ready starts
    for (const s of steps) {
      if (s.state === "working" || (s.state === "ready" && s.kind === "approval")) {
        s.left -= 1;
        if (s.left <= 0) s.state = "done";
      }
    }
    for (const s of steps) {
      if (s.state === "ready" && s.kind !== "approval") {
        s.state = "working";
        if (s.kind === "task") s.worker = `Worker ${++workers}`;
        else s.worker = s.kind === "final" ? "Core: merging" : "Core";
      }
    }
    for (const s of steps) {
      if (s.state === "waiting" && before(s.id).every((id) => steps.find((x) => x.id === id).state === "done")) s.state = "ready";
    }
  }
  return steps.map((s) => ({ ...s, worker: s.state === "working" ? s.worker : null, note: s.kind === "approval" && s.state === "ready" ? "Waiting on you (the sample approves it in a moment)" : null }));
}

/** How many ticks one loop takes: until everything's done, plus a rest. */
function loopLength(sample) {
  for (let t = 1; t < 200; t++) if (simulate(sample, t).every((s) => s.state === "done")) return t + 3;
  return 30;
}

/** A sample run playing: its steps now (looping), or null when it isn't playing. */
export function useSampleRun(sample, playing) {
  const [tick, setTick] = useState({ of: null, n: 0 }); // counted from when this sample started playing
  useEffect(() => {
    if (!sample || !playing) return undefined;
    let n = 0;
    const t = setInterval(() => setTick({ of: sample.id, n: ++n }), TICK_MS);
    return () => clearInterval(t);
  }, [sample, playing]);
  if (!sample || !playing) return null;
  return simulate(sample, (tick.of === sample.id ? tick.n : 0) % loopLength(sample));
}
