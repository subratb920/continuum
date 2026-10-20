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

  // ── Mainframe migration (COBOL, PL/I) ─────────────────────────
  // The usual path: know the estate, decide the target and the waves with
  // you, convert code, copybooks, JCL and data in parallel, prove the new
  // system gives the same results (same input, same output; parallel runs),
  // then you approve the move. Each wave is one run of a template.
  {
    id: "sample-mf-cobol-java",
    group: "Mainframe migration",
    name: "COBOL to Java (refactor, one wave)",
    description:
      "Inventory the COBOL estate, map dependencies and business rules, agree the target and the wave with you, convert programs, copybooks, JCL and data at once, prove equivalence on the same inputs, then you approve the parallel run before it merges.",
    steps: [
      step("inv", "task", "Inventory the estate", 40, 260, {
        instructions:
          "From the source export, list every COBOL program, copybook, JCL job and PROC, CICS map and transaction, DB2 table, VSAM file and IMS segment, with size, last change and owner. Flag dead code (programs no job or transaction reaches).",
        scope: ["migration/inventory/"],
        check: "migration/inventory/catalog.csv lists every member of the export; no member unaccounted for",
      }),
      step("deps", "task", "Call and data dependencies", 320, 120, {
        instructions: "Build the graph: CALL and dynamic CALL targets, COPY members, JCL steps and their DD datasets, DB2 tables per program, CICS LINK/XCTL. Find clusters that can move together.",
        scope: ["migration/dependencies/"],
        check: "every program in the catalog appears in the graph; clusters.json has no program in two clusters",
      }),
      step("rules", "task", "Business rules from the code", 320, 400, {
        instructions:
          "From each PROCEDURE DIVISION in scope, write the business rules in plain words (calculations, validations, rounding, date handling) with the paragraph each comes from. Note rules hidden in copybook REDEFINES and 88-levels.",
        scope: ["migration/rules/"],
        check: "every paragraph that changes data has a rule or a note saying why not",
      }),
      step("plan", "review", "Brain plans target and wave", 600, 260, {
        instructions: "Choose the first wave: a low-risk cluster with few callers. Target: Java services and batch jobs on the cloud; DB2 and VSAM data to PostgreSQL. List what the wave needs from outside it (shared copybooks, files other jobs still write).",
      }),
      step("ok-plan", "approval", "Your approval: target and wave 1", 880, 260, { instructions: "The wave's programs, what stays on the mainframe for now, and the interfaces in between." }),
      step("code", "task", "Programs to Java", 1160, 40, {
        instructions: "Convert the wave's programs to Java, one class per program, paragraphs as methods; keep the rules' names. Fixed-point arithmetic stays exact (BigDecimal, the same rounding as ROUNDED).",
        scope: ["app/src/main/java/programs/"],
        check: "./gradlew build",
      }),
      step("copy", "task", "Copybooks to records", 1160, 190, {
        instructions: "Each copybook becomes a record type with readers and writers for the original layout: COMP-3 packed decimal, signed zoned decimal, OCCURS DEPENDING ON, REDEFINES as alternatives.",
        scope: ["app/src/main/java/records/"],
        check: "round-trip tests: every sample record reads and writes back byte for byte",
      }),
      step("jcl", "task", "JCL to batch jobs", 1160, 340, {
        instructions: "Each job becomes a batch job: steps in order, COND and RC handling, restart points, GDG generations as dated files, SORT steps as code or a sort tool with the same collating order.",
        scope: ["app/src/main/java/jobs/", "ops/schedule/"],
        check: "every job step in the wave maps to a step here; dry run passes",
      }),
      step("data", "task", "Data conversion", 1160, 490, {
        instructions: "Scripts that move the wave's data: EBCDIC to UTF-8 (only text fields), packed and zoned decimals to numbers, dates (YYDDD, CYYMMDD) to dates, LOW-VALUES and HIGH-VALUES to agreed values; VSAM KSDS to tables with the key as primary key.",
        scope: ["migration/data/"],
        check: "control totals (row counts, sums of amounts) match the source extract",
      }),
      step("equiv", "task", "Equivalence tests", 1440, 260, {
        instructions: "Run the same production-like inputs through the mainframe and the new code; compare outputs field by field after normalising known differences (encoding, trailing spaces). Every difference is either fixed or written down and agreed.",
        scope: ["migration/equivalence/"],
        check: "migration/equivalence/report.md: 0 unexplained differences",
      }),
      step("review", "review", "Brain review: equivalence, performance, gaps", 1720, 260, {
        instructions: "Differences explained; the batch window still fits; nothing in the wave still reads a dataset only the mainframe writes.",
      }),
      step("ok-run", "approval", "Your approval: parallel run", 2000, 260, { instructions: "Both systems ran side by side for the agreed days with the same results. Approve to cut this wave over." }),
      step("merge", "final", "Merge wave 1", 2280, 260),
    ],
    edges: edges(
      ["inv", "deps"], ["inv", "rules"], ["deps", "plan"], ["rules", "plan"], ["plan", "ok-plan"],
      ["ok-plan", "code"], ["ok-plan", "copy"], ["ok-plan", "jcl"], ["ok-plan", "data"],
      ["code", "equiv"], ["copy", "equiv"], ["jcl", "equiv"], ["data", "equiv"],
      ["equiv", "review"], ["review", "ok-run"], ["ok-run", "merge"]
    ),
  },
  {
    id: "sample-mf-pli-batch",
    group: "Mainframe migration",
    name: "PL/I batch to the cloud (replatform)",
    description: "Keep the PL/I code, compile and run it off the mainframe: fix platform differences, replace JCL and datasets, prove the same results inside the batch window.",
    steps: [
      step("inv", "task", "Inventory PL/I and its jobs", 40, 200, {
        instructions: "List PL/I programs and %INCLUDE members, the JCL that runs them, the datasets they read and write (RECFM, LRECL), and the utilities used (SORT, IDCAMS, IEBGENER).",
        scope: ["migration/inventory/"],
        check: "every program, include and job is listed with its datasets",
      }),
      step("compile", "task", "Compile on the target", 320, 60, {
        instructions: "Build every program with the target platform's PL/I compiler; list what doesn't compile and why (built-ins, compile options, mainframe-only calls).",
        scope: ["build/"],
        check: "build log: every program compiles, or has a listed fix",
      }),
      step("platform", "task", "Fix platform differences", 320, 200, {
        instructions: "EBCDIC versus ASCII order in compares and SORT keys, FIXED DECIMAL and PICTURE edits, record formats (FB, VB with record descriptors), ON-units and condition codes, calls to system services.",
        scope: ["src/"],
        check: "unit runs with sample records give the mainframe's output",
      }),
      step("jcl", "task", "JCL and datasets to scripts and storage", 320, 340, {
        instructions: "Each job as a script or scheduler job; datasets as files in object storage with the same names mapped; GDGs as dated generations; SORT and IDCAMS steps with equivalent tools.",
        scope: ["ops/jobs/", "ops/storage-map.yaml"],
        check: "dry run of every job in the right order",
      }),
      step("regress", "task", "Regression with production-like input", 600, 200, {
        instructions: "Run a full night's input; compare every output dataset with the mainframe's from the same input.",
        scope: ["migration/regression/"],
        check: "0 unexplained differences",
      }),
      step("window", "review", "Brain review: batch window and restarts", 880, 200, { instructions: "The whole chain finishes inside the window with margin; a failed step restarts from its checkpoint." }),
      step("ok", "approval", "Your approval: cut over the batch", 1160, 200),
      step("merge", "final", "Merge", 1440, 200),
    ],
    edges: edges(["inv", "compile"], ["inv", "platform"], ["inv", "jcl"], ["compile", "regress"], ["platform", "regress"], ["jcl", "regress"], ["regress", "window"], ["window", "ok"], ["ok", "merge"]),
  },
  {
    id: "sample-mf-data",
    group: "Mainframe migration",
    name: "Mainframe data to PostgreSQL",
    description: "DB2, VSAM and IMS data to PostgreSQL: map the layouts, convert the encodings and numbers, load and reconcile to the cent before you sign off.",
    steps: [
      step("profile", "task", "Profile the data", 40, 200, {
        instructions: "For each DB2 table, VSAM file and IMS segment: record counts, key uniqueness, fields that hold LOW-VALUES, spaces or invalid packed decimals, dates in each format.",
        scope: ["migration/data/profile/"],
        check: "a profile per source with counts and anomalies",
      }),
      step("schema", "task", "Layouts to tables", 320, 100, {
        instructions: "Copybook and DCLGEN layouts to PostgreSQL DDL: OCCURS as child tables, REDEFINES as typed alternatives, packed decimals as NUMERIC with the same precision, keys and indexes.",
        scope: ["migration/data/ddl/"],
        check: "DDL applies to an empty database; every source field has a column or a reason",
      }),
      step("convert", "task", "Conversion scripts", 320, 300, {
        instructions: "Extract, convert and load: EBCDIC text to UTF-8 (code page agreed), COMP-3 and zoned decimals to numbers, dates to DATE, binary fields kept as numbers; bad values to a reject file, never dropped.",
        scope: ["migration/data/convert/"],
        check: "a sample extract converts with 0 silent changes; rejects listed",
      }),
      step("load", "task", "Trial load and reconciliation", 600, 200, {
        instructions: "Load a full copy; reconcile per table: row counts, sums of every amount field, hash totals of keys, a field-by-field sample.",
        scope: ["migration/data/reconcile/"],
        check: "counts and control totals equal the source extract",
      }),
      step("ri", "review", "Brain review: integrity and rejects", 880, 200, { instructions: "Foreign keys hold; every reject has a cause and a fix or an agreed decision." }),
      step("ok", "approval", "Your sign-off on the data", 1160, 200),
      step("merge", "final", "Merge", 1440, 200),
    ],
    edges: edges(["profile", "schema"], ["profile", "convert"], ["schema", "load"], ["convert", "load"], ["load", "ri"], ["ri", "ok"], ["ok", "merge"]),
  },
  {
    id: "sample-mf-cics",
    group: "Mainframe migration",
    name: "CICS screens to APIs and web pages",
    description: "Online CICS transactions become APIs and web pages: same rules, same security, tested end to end against the 3270 screens.",
    steps: [
      step("inv", "task", "Transactions and screens", 40, 200, {
        instructions: "List CICS transactions, their programs, BMS maps and the flow between screens (pseudo-conversational: what each keeps in the COMMAREA or a TS queue).",
        scope: ["migration/online/inventory/"],
        check: "every transaction ID has its programs, maps and next screens",
      }),
      step("api", "task", "API design", 320, 80, {
        instructions: "One API call per business action (not per screen); requests and responses from the maps' fields; errors from the programs' messages.",
        scope: ["api/openapi.yaml"],
        check: "OpenAPI file validates; every transaction's actions are covered",
      }),
      step("security", "task", "Security mapping", 320, 320, {
        instructions: "RACF profiles and transaction security to roles and permissions on the new APIs; sign-on to the company's single sign-on.",
        scope: ["api/security/"],
        check: "each transaction's allowed groups map to a role",
      }),
      step("services", "task", "Services", 600, 80, {
        instructions: "Implement the APIs with the business rules from the programs; data through the migrated tables.",
        scope: ["api/src/"],
        check: "npm test",
      }),
      step("pages", "task", "Web pages from the maps", 600, 320, {
        instructions: "Pages for the screens people use, with the same fields and keys where it helps (PF keys as buttons); flows as in the inventory.",
        scope: ["web/src/"],
        check: "npm run build",
      }),
      step("e2e", "task", "End-to-end against the 3270 screens", 880, 200, {
        instructions: "The same scripted inputs on the old screens and the new pages give the same results and messages.",
        scope: ["e2e/"],
        check: "npm run e2e",
      }),
      step("review", "review", "Brain review", 1160, 200, { instructions: "Rules, security and messages match; response times inside the agreed limits." }),
      step("ok", "approval", "Your approval: switch users over", 1440, 200),
      step("merge", "final", "Merge", 1720, 200),
    ],
    edges: edges(["inv", "api"], ["inv", "security"], ["api", "services"], ["security", "services"], ["inv", "pages"], ["services", "e2e"], ["pages", "e2e"], ["e2e", "review"], ["review", "ok"], ["ok", "merge"]),
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
