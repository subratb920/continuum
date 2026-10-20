import { useEffect, useState } from "react";

/**
 * Sample workflows: ready-made templates to look at, watch run (played in
 * the page: nothing starts, no worker is used) and copy as your own.
 *
 * A run follows the arrows: a step starts when every step before it is done;
 * tasks take a worker each, the brain reviews, your approvals wait a moment.
 * Real work rarely passes first time, so the samples fail too: a loop arrow
 * (loop: true) sends the work back to an earlier step, and the steps between
 * run again — fix, test, fix again — until it passes. In a sample, sim says
 * how many times a step fails before it passes, and notes what each failed
 * try reported (the next try does better).
 */
const TICK_MS = 1300;
const LASTS = { task: 3, review: 2, approval: 2, final: 2 }; // ticks a step takes (an approval: waiting on you)

const step = (id, kind, title, x, y, more = {}) => ({ id, kind, title, instructions: "", scope: [], check: "", goalId: null, x, y, state: "waiting", agentId: null, note: null, ...more });
const edges = (...pairs) => pairs.map(([from, to]) => ({ from, to }));
/** A loop arrow: when from fails (or is sent back), back to to. sim/notes: how the sample plays it. */
const loop = (from, to, label, sim = 1, notes = [], max = 5) => ({ from, to, loop: true, label, max, sim, notes });

// Grid for the layouts: columns and rows on the canvas
const C = (n) => n * 270;
const R = (n) => n * 150;

export const SAMPLE_WORKFLOWS = [
  // ── Everyday work ─────────────────────────────────────────────
  {
    id: "sample-feature",
    name: "Feature with tests",
    description: "Back end and front end at once; end-to-end tests send the page back until they pass; the brain reviews; you may ask for changes before it merges.",
    steps: [
      step("api", "task", "API endpoint", C(0), R(0), { instructions: "Add the endpoint and its validation.", scope: ["api/"], check: "cd api && npm test" }),
      step("ui", "task", "Page and form", C(0), R(1.3), { instructions: "Add the page that calls the endpoint.", scope: ["web/src/"], check: "cd web && npm run build" }),
      step("tests", "task", "End-to-end tests", C(1), R(0.65), { instructions: "Cover the new flow end to end; report each failure with the step it fails at.", scope: ["e2e/"], check: "npm run e2e" }),
      step("review", "review", "Brain review", C(2), R(0), { instructions: "Both halves agree; tests cover the new flow." }),
      step("ok", "approval", "Your approval", C(2), R(1.3), { instructions: "Look at the change before it merges. Send it back with what to change." }),
      step("merge", "final", "Merge into your folder", C(3), R(1.3)),
    ],
    edges: [
      ...edges(["api", "tests"], ["ui", "tests"], ["tests", "review"], ["review", "ok"], ["ok", "merge"]),
      loop("tests", "ui", "e2e fails", 1, ["2 of 14 flows fail: the form doesn't show the API's errors"]),
      loop("ok", "review", "you ask for changes", 1, ["You: keep the old URL working too"]),
    ],
  },
  {
    id: "sample-bugfix",
    name: "Bug fix",
    description: "A failing test that shows the bug, then fix and test round the loop until the whole suite passes.",
    steps: [
      step("repro", "task", "Failing test that shows the bug", C(0), R(0), { instructions: "Write a test that fails the way the bug report says.", scope: ["test/"], check: "npm test (fails, as reported)" }),
      step("fix", "task", "Fix", C(1), R(0), { instructions: "Make the new test pass without changing it; on a later try, start from what the suite reported.", scope: ["src/"] }),
      step("suite", "task", "Whole suite", C(2), R(0), { instructions: "Run every test, not only the new one; report what fails.", check: "npm test" }),
      step("review", "review", "Brain review", C(2), R(1.2), { instructions: "The fix is the smallest that works; nothing else changed." }),
      step("merge", "final", "Merge", C(3), R(1.2)),
    ],
    edges: [...edges(["repro", "fix"], ["fix", "suite"], ["suite", "review"], ["review", "merge"]), loop("suite", "fix", "tests fail", 2, ["3 tests fail: rounding in the totals", "1 test fails: the empty cart"])],
  },
  {
    id: "sample-docs",
    name: "Docs and release notes",
    description: "Three writers at once, a review, and your sign-off — which can send it back.",
    steps: [
      step("readme", "task", "README", C(0), R(0), { scope: ["README.md"] }),
      step("api-docs", "task", "API docs", C(0), R(1), { scope: ["docs/api/"] }),
      step("changelog", "task", "Changelog", C(0), R(2), { scope: ["CHANGELOG.md"] }),
      step("review", "review", "Brain review", C(1), R(1), { instructions: "Docs match the code; nothing contradicts." }),
      step("ok", "approval", "Your sign-off", C(2), R(1)),
    ],
    edges: [...edges(["readme", "review"], ["api-docs", "review"], ["changelog", "review"], ["review", "ok"]), loop("ok", "review", "you ask for changes", 1, ["You: the upgrade steps are missing"])],
  },
  {
    id: "sample-refactor",
    name: "Refactor in parts",
    description: "Split a refactor into parts that don't share files, check them together, send back the part that breaks the contract.",
    steps: [
      step("plan", "review", "Brain plans the parts", C(0), R(1), { instructions: "Split the work so no two parts touch the same files." }),
      step("p1", "task", "Part 1: data layer", C(1), R(0), { scope: ["src/data/"], check: "npm test -- data" }),
      step("p2", "task", "Part 2: services", C(1), R(1), { scope: ["src/services/"], check: "npm test -- services" }),
      step("p3", "task", "Part 3: routes", C(1), R(2), { scope: ["src/routes/"], check: "npm test -- routes" }),
      step("contract", "task", "Contract tests, all parts", C(2), R(1), { instructions: "Run the API contract tests against the three parts together.", check: "npm run test:contract" }),
      step("ok", "approval", "Your approval", C(3), R(1)),
      step("merge", "final", "Merge all parts", C(3), R(2.2)),
    ],
    edges: [...edges(["plan", "p1"], ["plan", "p2"], ["plan", "p3"], ["p1", "contract"], ["p2", "contract"], ["p3", "contract"], ["contract", "ok"], ["ok", "merge"]), loop("contract", "p2", "contract breaks", 1, ["Services return dates in another format"])],
  },

  // ── Mainframe migration (COBOL, PL/I) ─────────────────────────
  // Nothing passes first time: outputs differ, and the new system is slower
  // than the mainframe until its architecture is tuned. The loops are where
  // a migration spends its time — equivalence until the results match, load
  // tests until it carries the mainframe's volume (e.g. 100,000 requests a
  // second, and the night's batch inside its window).
  {
    id: "sample-mf-cobol-java",
    group: "Mainframe migration",
    name: "COBOL to Java (refactor, one wave)",
    description:
      "Discovery, a wave you agree, conversion of programs, copybooks, JCL and data at once, then the loops that take the time: equivalence until outputs match, load tests until it carries 100,000 requests a second and the batch window, and a parallel run before you cut over.",
    steps: [
      // Discovery
      step("inv", "task", "Inventory the estate", C(0), R(0.6), {
        instructions:
          "From the source export, list every COBOL program, copybook, JCL job and PROC, CICS map and transaction, DB2 table, VSAM file and IMS segment, with size, last change and owner. Flag dead code (programs no job or transaction reaches). Record today's volumes: peak transactions a second, the night's record counts and its batch window.",
        scope: ["migration/inventory/"],
        check: "catalog.csv lists every member of the export; volumes.md has the peak and the window",
      }),
      step("deps", "task", "Call and data dependencies", C(1), R(0), {
        instructions: "Build the graph: CALL and dynamic CALL targets, COPY members, JCL steps and their DD datasets, DB2 tables per program, CICS LINK/XCTL. Find clusters that can move together.",
        scope: ["migration/dependencies/"],
        check: "every program in the catalog appears in the graph; no program in two clusters",
      }),
      step("rules", "task", "Business rules from the code", C(1), R(1.2), {
        instructions: "Write each PROCEDURE DIVISION's business rules in plain words (calculations, validations, rounding, dates) with the paragraph each comes from; rules hidden in REDEFINES and 88-levels too.",
        scope: ["migration/rules/"],
        check: "every paragraph that changes data has a rule or a note",
      }),
      step("plan", "review", "Brain plans target and wave", C(2), R(0.6), {
        instructions: "First wave: a low-risk cluster with few callers. Target: Java services and batch on the cloud, data in PostgreSQL. What the wave still needs from the mainframe, and how they talk meanwhile.",
      }),
      step("ok-plan", "approval", "Your approval: target and wave 1", C(3), R(0.6), { instructions: "The wave's programs, what stays on the mainframe for now, the interfaces in between. Send it back to change the wave." }),
      // Conversion, four at once
      step("code", "task", "Programs to Java", C(0), R(2.6), {
        instructions: "One class per program, paragraphs as methods, the rules' names kept. Exact fixed-point arithmetic (BigDecimal, the same rounding as ROUNDED). On a later try: fix what the equivalence report found.",
        scope: ["app/src/main/java/programs/"],
        check: "./gradlew build",
      }),
      step("copy", "task", "Copybooks to records", C(1), R(2.6), {
        instructions: "Each copybook a record type with readers and writers for the original layout: COMP-3 packed decimal, signed zoned decimal, OCCURS DEPENDING ON, REDEFINES as alternatives.",
        scope: ["app/src/main/java/records/"],
        check: "every sample record reads and writes back byte for byte",
      }),
      step("jcl", "task", "JCL to batch jobs", C(2), R(2.6), {
        instructions: "Each job a batch job: steps in order, COND and return codes, restart points, GDG generations as dated files, SORT with the same collating order.",
        scope: ["app/src/main/java/jobs/", "ops/schedule/"],
        check: "every job step in the wave maps to a step; dry run passes",
      }),
      step("data", "task", "Data conversion", C(3), R(2.6), {
        instructions: "EBCDIC to UTF-8 (text fields only), packed and zoned decimals to numbers, dates (YYDDD, CYYMMDD) to dates, LOW-VALUES to agreed values; VSAM KSDS to tables keyed the same.",
        scope: ["migration/data/"],
        check: "row counts and amount totals match the source extract",
      }),
      // Proving it: the loops
      step("equiv", "task", "Equivalence tests", C(0), R(4), {
        instructions: "The same production-like inputs through the mainframe and the new code; outputs compared field by field after normalising known differences. Report every difference with its record and field.",
        scope: ["migration/equivalence/"],
        check: "0 unexplained differences",
      }),
      step("perf", "task", "Performance architecture", C(1), R(4), {
        instructions:
          "Make it carry the mainframe's volume: partition by account key, scale out stateless services, batch commits, connection pools sized to the database, reference data cached, no chatty calls in loops, parallel batch steps where the old job ran them in sequence. On a later try: fix the bottleneck the load test found.",
        scope: ["app/", "ops/infra/"],
      }),
      step("load", "task", "Load test: 100k req/s and the batch window", C(2), R(4), {
        instructions: "Replay the peak: 100,000 requests a second for 30 minutes, p99 under 50 ms, no errors; then the full night's batch on the night's volume inside its window. Report throughput, p99, the slowest step and the bottleneck.",
        scope: ["migration/performance/"],
        check: "≥ 100,000 req/s sustained, p99 < 50 ms; batch inside the window",
      }),
      step("review", "review", "Brain review", C(3), R(4), { instructions: "Differences explained, volume carried with margin, nothing in the wave still reads a dataset only the mainframe writes." }),
      // Cutting over
      step("parallel", "task", "Parallel run with the mainframe", C(1), R(5.4), {
        instructions: "Both systems take the same day's work for the agreed days; compare every output each day.",
        scope: ["migration/parallel-run/"],
        check: "every day's outputs match",
      }),
      step("ok-run", "approval", "Your approval: cut over wave 1", C(2), R(5.4), { instructions: "The parallel run matched and the volume holds. Approve to move this wave's users and jobs over." }),
      step("merge", "final", "Merge wave 1", C(3), R(5.4)),
    ],
    edges: [
      ...edges(
        ["inv", "deps"], ["inv", "rules"], ["deps", "plan"], ["rules", "plan"], ["plan", "ok-plan"],
        ["ok-plan", "code"], ["ok-plan", "copy"], ["ok-plan", "jcl"], ["ok-plan", "data"],
        ["code", "equiv"], ["copy", "equiv"], ["jcl", "equiv"], ["data", "equiv"],
        ["equiv", "perf"], ["perf", "load"], ["load", "review"], ["review", "parallel"], ["parallel", "ok-run"], ["ok-run", "merge"]
      ),
      loop("ok-plan", "plan", "you change the wave", 1, ["You: leave the billing programs for wave 2"]),
      loop("equiv", "code", "outputs differ", 2, ["412 records differ: ROUNDED, and negative zoned decimals", "37 records differ: dates before 2000"]),
      loop("load", "perf", "below target", 3, ["41k req/s, p99 380 ms: one database connection pool for all", "72k req/s: batch takes 5 h 40 m, the window is 4 h", "94k req/s, p99 120 ms: account lookups uncached"], 8),
      loop("parallel", "equiv", "a day's results differ", 1, ["Day 3: month-end interest differs on 12 accounts"]),
    ],
  },
  {
    id: "sample-mf-pli-batch",
    group: "Mainframe migration",
    name: "PL/I batch to the cloud (replatform)",
    description: "Keep the PL/I, run it off the mainframe: fix platform differences until outputs match, then tune until a full night's volume fits the batch window.",
    steps: [
      step("inv", "task", "Inventory PL/I and its jobs", C(0), R(1), {
        instructions: "PL/I programs and %INCLUDE members, the JCL that runs them, the datasets (RECFM, LRECL), utilities used (SORT, IDCAMS, IEBGENER), the night's volume and its window.",
        scope: ["migration/inventory/"],
        check: "every program, include, job and dataset listed",
      }),
      step("compile", "task", "Compile on the target", C(1), R(0), { instructions: "Build every program with the target's PL/I compiler; list what doesn't compile and why.", scope: ["build/"], check: "every program compiles, or has a listed fix" }),
      step("platform", "task", "Fix platform differences", C(1), R(1), {
        instructions: "EBCDIC versus ASCII order in compares and SORT keys, FIXED DECIMAL and PICTURE edits, FB and VB records, ON-units and condition codes. On a later try: the differences regression found.",
        scope: ["src/"],
      }),
      step("jcl", "task", "JCL and datasets to scripts and storage", C(1), R(2), { instructions: "Jobs as scheduler jobs, datasets as files in storage, GDGs as dated generations, SORT and IDCAMS with equivalent tools.", scope: ["ops/jobs/"], check: "dry run in the right order" }),
      step("regress", "task", "Regression on a night's input", C(2), R(1), { instructions: "A full night's input; every output dataset compared with the mainframe's from the same input.", scope: ["migration/regression/"], check: "0 unexplained differences" }),
      step("tune", "task", "Throughput tuning", C(3), R(0), { instructions: "Split long jobs by key range and run the ranges at once; bigger buffers and blocked I/O; sorts in memory where they fit. On a later try: the slowest step the window test found.", scope: ["ops/jobs/", "src/"] }),
      step("window", "task", "Batch window test: 50M records", C(3), R(1.3), { instructions: "The night's 50 million records end to end, restarts included.", check: "finishes inside the 4 h window with 20% margin" }),
      step("ok", "approval", "Your approval: cut over the batch", C(4), R(1.3)),
      step("merge", "final", "Merge", C(4), R(2.5)),
    ],
    edges: [
      ...edges(["inv", "compile"], ["inv", "platform"], ["inv", "jcl"], ["compile", "regress"], ["platform", "regress"], ["jcl", "regress"], ["regress", "tune"], ["tune", "window"], ["window", "ok"], ["ok", "merge"]),
      loop("regress", "platform", "outputs differ", 2, ["SORT order differs: digits before letters in ASCII", "3 reports differ: FIXED DECIMAL overflow handled differently"]),
      loop("window", "tune", "misses the window", 2, ["7 h 10 m: one job reads the master file 6 times", "4 h 50 m: the sort spills to disk"], 8),
    ],
  },
  {
    id: "sample-mf-data",
    group: "Mainframe migration",
    name: "Mainframe data to PostgreSQL",
    description: "DB2, VSAM and IMS data to PostgreSQL: convert until the totals reconcile to the cent, then make the load fast enough for the cutover window.",
    steps: [
      step("profile", "task", "Profile the data", C(0), R(1), {
        instructions: "Per DB2 table, VSAM file and IMS segment: counts, key uniqueness, LOW-VALUES and spaces, invalid packed decimals, every date format.",
        scope: ["migration/data/profile/"],
        check: "a profile per source with counts and anomalies",
      }),
      step("schema", "task", "Layouts to tables", C(1), R(0), { instructions: "Copybook and DCLGEN layouts to DDL: OCCURS as child tables, REDEFINES as typed alternatives, packed decimals as NUMERIC of the same precision.", scope: ["migration/data/ddl/"], check: "DDL applies; every field has a column or a reason" }),
      step("convert", "task", "Conversion scripts", C(1), R(2), { instructions: "EBCDIC text to UTF-8, COMP-3 and zoned to numbers, dates to DATE; bad values to a reject file, never dropped. On a later try: what reconciliation found.", scope: ["migration/data/convert/"] }),
      step("load", "task", "Trial load", C(2), R(1), { instructions: "Load a full copy; on a later try, faster: COPY in parallel per table, indexes and keys after the load.", scope: ["migration/data/load/"] }),
      step("recon", "task", "Reconcile to the cent", C(3), R(0), { instructions: "Per table: row counts, the sum of every amount field, hash totals of keys, a field-by-field sample.", scope: ["migration/data/reconcile/"], check: "every count and total equals the source" }),
      step("speed", "task", "Load inside the cutover window", C(3), R(2), { instructions: "Time the full load from extract to keys built.", check: "under 6 hours, the agreed cutover window" }),
      step("ok", "approval", "Your sign-off on the data", C(4), R(1)),
      step("merge", "final", "Merge", C(4), R(2.2)),
    ],
    edges: [
      ...edges(["profile", "schema"], ["profile", "convert"], ["schema", "load"], ["convert", "load"], ["load", "recon"], ["load", "speed"], ["recon", "ok"], ["speed", "ok"], ["ok", "merge"]),
      loop("recon", "convert", "totals differ", 2, ["Amounts off by 1.4M: COMP-3 sign nibble read as positive", "3 rows: dates 000000 in a NOT NULL column"]),
      loop("speed", "load", "too slow for the window", 1, ["11 h 20 m: indexes built during the load"]),
    ],
  },
  {
    id: "sample-mf-cics",
    group: "Mainframe migration",
    name: "CICS screens to APIs and web pages",
    description: "Online CICS transactions become APIs and web pages: tested against the 3270 screens until they match, then scaled until they carry 100,000 requests a second.",
    steps: [
      step("inv", "task", "Transactions and screens", C(0), R(1.2), {
        instructions: "CICS transactions, their programs, BMS maps and the flow between screens (what each keeps in the COMMAREA or a TS queue); today's peak per transaction.",
        scope: ["migration/online/inventory/"],
        check: "every transaction has its programs, maps, next screens and peak",
      }),
      step("api", "task", "API design", C(1), R(0), { instructions: "One call per business action (not per screen); fields from the maps; errors from the programs' messages.", scope: ["api/openapi.yaml"], check: "the OpenAPI file validates" }),
      step("security", "task", "RACF to roles", C(1), R(1.2), { instructions: "RACF profiles and transaction security to roles on the new APIs; sign-on through single sign-on.", scope: ["api/security/"], check: "each transaction's groups map to a role" }),
      step("pages", "task", "Web pages from the maps", C(1), R(2.4), { instructions: "Pages for the screens people use; PF keys as buttons; the same flows.", scope: ["web/src/"], check: "npm run build" }),
      step("services", "task", "Services", C(2), R(0.6), { instructions: "The APIs with the programs' business rules, on the migrated tables. On a later try: what end-to-end found.", scope: ["api/src/"], check: "npm test" }),
      step("e2e", "task", "End-to-end against the 3270 screens", C(2), R(2), { instructions: "The same scripted inputs on the old screens and the new pages: the same results and messages.", scope: ["e2e/"], check: "every script matches" }),
      step("scale", "task", "Scale-out architecture", C(3), R(0.6), {
        instructions: "Stateless services behind a load balancer, autoscaling on load, read replicas for lookups, a cache for reference data, the hot paths without remote calls in loops. On a later try: the bottleneck the load test found.",
        scope: ["api/", "ops/infra/"],
      }),
      step("load", "task", "Load test: 100k req/s", C(3), R(2), { instructions: "The peak mix of transactions at 100,000 requests a second for 30 minutes.", scope: ["migration/performance/"], check: "≥ 100k req/s, p99 < 50 ms, 0 errors" }),
      step("review", "review", "Brain review", C(4), R(0.6), { instructions: "Rules, security and messages match; the volume holds with margin." }),
      step("ok", "approval", "Your approval: switch users over", C(4), R(2)),
      step("merge", "final", "Merge", C(5), R(2)),
    ],
    edges: [
      ...edges(["inv", "api"], ["inv", "security"], ["inv", "pages"], ["api", "services"], ["security", "services"], ["services", "e2e"], ["pages", "e2e"], ["e2e", "scale"], ["scale", "load"], ["load", "review"], ["review", "ok"], ["ok", "merge"]),
      loop("e2e", "services", "screens differ", 1, ["Inquiry shows 2 decimals, the screen showed 3"]),
      loop("load", "scale", "below 100k req/s", 2, ["58k req/s: every call checks RACF roles remotely", "87k req/s, p99 140 ms: lookups hit the primary database"], 8),
    ],
  },
];

const fwd = (edges) => edges.filter((e) => !e.loop);
const reaches = (edges, a, b, seen = new Set()) => a === b || (!seen.has(a) && (seen.add(a), fwd(edges).some((e) => e.from === a && reaches(edges, e.to, b, seen))));

/**
 * A sample's steps after this many ticks of a pretend run (from the start;
 * it loops). A step with a loop arrow fails its first sim tries (its note
 * says what failed), then the work goes back and the steps between run again.
 */
export function simulate(sample, ticks) {
  const steps = sample.steps.map((s) => ({ ...s, state: "waiting", worker: null, left: LASTS[s.kind], tries: 0, note: null }));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const before = (id) => fwd(sample.edges).filter((e) => e.to === id).map((e) => e.from);
  const failed = new Map(); // step id → how many times it has failed
  let workers = 0;
  for (let t = 0; t < ticks; t++) {
    // A step that failed last tick: the work goes back along its loop
    for (const s of steps.filter((x) => x.state === "failed")) {
      const back = sample.edges.find((e) => e.loop && e.from === s.id);
      const to = byId.get(back.to);
      for (const x of steps) {
        if (x.id === s.id || (reaches(sample.edges, back.to, x.id) && reaches(sample.edges, x.id, s.id))) Object.assign(x, { state: "waiting", worker: null, left: LASTS[x.kind], note: x.id === s.id ? x.note : null });
      }
      to.tries += 1;
      to.note = `Back again (try ${to.tries + 1}): ${s.note}`;
    }
    // What's working (or waiting on you) moves on: done, or failed if this try is one that fails
    for (const s of steps) {
      if (s.state === "working" || (s.state === "ready" && s.kind === "approval")) {
        s.left -= 1;
        if (s.left > 0) continue;
        const back = sample.edges.find((e) => e.loop && e.from === s.id);
        const n = failed.get(s.id) ?? 0;
        if (back && n < (back.sim ?? 0)) {
          failed.set(s.id, n + 1);
          s.state = "failed";
          s.note = back.notes?.[n] ?? back.label;
        } else {
          s.state = "done";
          if (back && n > 0) s.note = s.kind === "approval" ? "Approved" : "Passed";
        }
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
      if (s.state === "waiting" && before(s.id).every((id) => byId.get(id).state === "done")) s.state = "ready";
    }
  }
  return steps.map((s) => ({
    ...s,
    worker: s.state === "working" ? s.worker : null,
    note: s.kind === "approval" && s.state === "ready" ? "Waiting on you (the sample decides in a moment)" : s.note,
  }));
}

/** How many ticks one loop takes: until everything's done, plus a rest. */
function loopLength(sample) {
  for (let t = 1; t < 400; t++) if (simulate(sample, t).every((s) => s.state === "done")) return t + 3;
  return 60;
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
