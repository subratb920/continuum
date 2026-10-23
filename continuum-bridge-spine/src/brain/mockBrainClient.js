/**
 * A pretend brain, until brain-api serves the real one (VITE_BRAIN_MODE=mock,
 * the default). It plays what the orchestrator will report: the core reads the
 * running interval and starts a worker per session goal; workers read, edit and
 * test, ask before changing anything, ask questions, finish or fail. Answers,
 * spawns, stops and retries all work.
 *
 * @returns {import("./brainTypes").BrainClient}
 */
export function createMockBrainClient({ speed = 1 } = {}) {
  const agents = new Map();
  const listeners = new Set();
  const waiting = new Map(); // eventId → { agentId, resolve(answer) }
  const stopped = new Set(); // agents asked to stop: their scripts end
  const history = []; // every event so far: a new subscriber catches up (as brain-api's after= will)
  let seq = 0;
  let agentSeq = 0;
  let started = false;
  let interval = null; // { bridgeId, goals: [{ id, text }] } — the running interval, from the app

  const now = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, (ms * (0.7 + Math.random() * 0.6)) / speed));
  const emit = (m) => listeners.forEach((fn) => fn(m));
  const coreId = () => [...agents.values()].find((a) => a.kind === "core")?._id;

  function event(agentId, kind, text, data) {
    const e = { _id: `e${String(++seq).padStart(7, "0")}`, seq, agentId, at: now(), kind, text, ...(data && { data }) };
    if (history.push(e) > 5000) history.shift();
    emit({ type: "event", event: e });
    return e;
  }

  function update(id, changes) {
    const a = agents.get(id);
    Object.assign(a, changes);
    emit({ type: "agent", agent: { ...a } });
  }

  function setState(id, state, extra = {}) {
    const a = agents.get(id);
    if (!a || a.state === state) return;
    update(id, {
      state,
      ...extra,
      ...(state === "starting" && !a.startedAt && { startedAt: now(), runtimeModel: a.model }), // what it runs on, once started (as the orchestrator says)
      ...((state === "stopped" || state === "failed") && { finishedAt: now() }),
    });
    event(id, "state", state, { state });
  }

  // The models a pretend brain offers, and your choice (as brain-api's /models and /settings)
  const MODELS = {
    providers: [
      { provider: "ollama", setUp: true },
      { provider: "anthropic", setUp: false },
      { provider: "openai", setUp: false },
      { provider: "opencode", setUp: true },
      { provider: "compat", setUp: false },
    ],
    models: [
      { id: "ollama/neural-chat:latest", provider: "ollama", name: "neural-chat:latest", tools: false, maxContext: 32768, size: "7B" },
      { id: "ollama/qwen3:1.7b", provider: "ollama", name: "qwen3:1.7b", tools: true, maxContext: 40960, size: "2.0B" },
      { id: "ollama/qwen3:4b", provider: "ollama", name: "qwen3:4b", tools: true, maxContext: 40960, size: "4.0B" },
      { id: "opencode/big-pickle", provider: "opencode", name: "big-pickle", tools: true, maxContext: null },
    ],
  };
  const DEFAULT_MODEL = "ollama/qwen3:4b";
  const TIER_NAMES = ["small", "standard", "strong"];
  // The brain's and workers' own models, optional per-tier worker models, automatic routing, speed, tools, spend cap
  const choice = { brainModel: null, workerModel: null, tiers: {}, autoRoute: true, mode: "fast", tools: "lean", budgetCapUsd: null };
  const DEMO_SPEND = 2.37; // pretend spend this period (billed at the rate card), so the budget readout shows something
  const USD_PER_TOKEN = 0.0000042; // ~Claude Sonnet blended ($4.2 / 1M), for the demo
  const budgetView = () => {
    const cap = typeof choice.budgetCapUsd === "number" ? choice.budgetCapUsd : 0; // 0 = unlimited (no server default in the mock)
    const periodCostUsd = DEMO_SPEND;
    const state = cap <= 0 ? "off" : periodCostUsd >= cap ? "exceeded" : periodCostUsd >= cap * 0.8 ? "warn" : "ok";
    return {
      capUsd: cap,
      userCapUsd: typeof choice.budgetCapUsd === "number" ? choice.budgetCapUsd : null,
      period: "monthly",
      periodCostUsd,
      periodTokens: Math.round(periodCostUsd / USD_PER_TOKEN),
      usdPerToken: USD_PER_TOKEN,
      remaining: cap > 0 ? Math.max(0, cap - periodCostUsd) : null,
      capTokens: cap > 0 ? Math.round(cap / USD_PER_TOKEN) : null,
      remainingTokens: cap > 0 ? Math.max(0, Math.round((cap - periodCostUsd) / USD_PER_TOKEN)) : null,
      state,
    };
  };
  const MODES = [
    { id: "fast", words: "Quicker replies, lighter on your computer: a smaller context, and no thinking before each answer where the model allows it." },
    { id: "thorough", words: "More room and reasoning, slower: the biggest context and the model's own thinking." },
  ];
  const TOOLSETS = [
    { id: "lean", words: "About 3,200 tokens before each answer: no sub-agents, to-do list or web fetch. Faster on a local model." },
    { id: "full", words: "About 4,800 tokens before each answer: every tool, including sub-agents, a to-do list and web fetch." },
  ];
  const brainModelOf = () => choice.brainModel ?? DEFAULT_MODEL;
  const workerModelOf = () => choice.workerModel ?? choice.brainModel ?? DEFAULT_MODEL;
  const oneModel = () => brainModelOf();

  function addAgent(kind, task, { repo = null, goal = null, retryOf = null, model = null } = {}) {
    const id = `a${String(++agentSeq).padStart(4, "0")}`;
    const a = {
      _id: id,
      kind,
      projectId: repo ? "p-demo" : null,
      repo,
      branch: kind === "worker" ? `continuum/agent-${id}` : null,
      task,
      model: model ?? oneModel(),
      size: "standard",
      state: "queued",
      goal, // { bridgeId, goalId, text } — the interval goal it works on
      retryOf,
      retriedBy: null,
      error: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    };
    agents.set(id, a);
    emit({ type: "agent", agent: { ...a } });
    return id;
  }

  /** Asks and waits for the answer (reply()). */
  function ask(id, kind, text, data) {
    const e = event(id, kind, text, data);
    return new Promise((resolve) => waiting.set(e._id, { agentId: id, resolve }));
  }

  const alive = (id) => !stopped.has(id) && agents.get(id)?.state !== "failed";

  async function boot(id) {
    await sleep(900);
    setState(id, "starting");
    await sleep(1600);
    setState(id, "working");
  }

  /** A worker's task: look around, ask, edit, test, finish (or fail). */
  async function worker(id, { files, question, fails = false }) {
    await boot(id);
    for (const f of files.slice(0, 2)) {
      if (!alive(id)) return;
      event(id, "tool", `read ${f}`, { tool: "read", target: f });
      await sleep(1800);
    }
    event(id, "tool", "grep \"interval\"", { tool: "grep", target: "src/" });
    await sleep(2000);
    if (!alive(id)) return;
    if (question) {
      setState(id, "idle");
      const answer = await ask(id, "question", question.text, { options: question.options });
      if (!alive(id)) return;
      setState(id, "working");
      event(id, "text", `Going with ${answer}.`);
      await sleep(1500);
    }
    if (fails) {
      event(id, "tool", "bash npm test", { tool: "bash", target: "npm test" });
      await sleep(2600);
      event(id, "error", "npm test exited 1: 3 tests failed in bridge.model.test.js");
      setState(id, "failed", { error: { code: "TESTS_FAILED", message: "npm test exited 1" } });
      return;
    }
    const target = files[files.length - 1];
    setState(id, "idle");
    event(id, "text", `I'll add the goal progress to ${target} next; it needs your OK to edit it.`);
    const ok = await ask(id, "permission", `Edit ${target}`, { tool: "edit", target, diff: "+3 −1", detail: sampleDiff(target) });
    if (!alive(id)) return;
    setState(id, "working");
    if (ok !== "approve" && ok !== "always") {
      event(id, "text", `Skipped the edit to ${target}; leaving notes on the branch instead.`);
    } else {
      event(id, "tool", `edit ${target}`, { tool: "edit", target });
      await sleep(2200);
      event(id, "tool", "bash npm test", { tool: "bash", target: "npm test" });
      await sleep(2800);
      event(id, "text", "Tests pass. Committed to my branch.", { done: true });
    }
    await sleep(1200);
    setState(id, "idle");
  }

  /** The change a demo worker asks to make (what a real permission request carries as detail). */
  const sampleDiff = (file) =>
    [`--- a/${file}`, `+++ b/${file}`, "@@ -12,4 +12,6 @@", "   const goals = bridge.goals ?? [];", "-  return goals;", "+  const done = goals.filter((g) => g.status === \"done\").length;", "+  // Progress: done goals of all", "+  return { goals, done, total: goals.length };", " }"].join("\n");

  // What the demo workers do, by turn: the second asks a question, the third fails
  const SCRIPTS = [
    { files: ["src/routes/bridges.js", "src/models/bridge.model.js", "src/routes/bridges.js"] },
    { files: ["src/components/BridgeSpine.jsx", "src/components/BridgeSpine.css"], question: { text: "Progress as a bar or as a fraction (2/3)?", options: ["a bar", "a fraction"] } },
    { files: ["src/models/bridge.model.js"], fails: true },
  ];
  const DEMO_GOALS = [
    "Add a goal-progress endpoint to the bridge API",
    "Show goal progress on the Bridge Spine",
    "Migrate bridge goals to the new status field",
  ];

  function startWorker(task, { goal = null, retryOf = null, script, model = null } = {}) {
    const w = addAgent("worker", task, { repo: "subrat/continuum", goal, retryOf, model });
    worker(w, script ?? { files: ["src/App.jsx", "src/api.js"] });
    return w;
  }

  async function core() {
    const id = addAgent("core", "Your brain: plans the interval's goals and hands them to workers");
    await boot(id);
    // The running interval's goals (up to 3), or demo ones when none runs
    const goals = interval?.goals?.length
      ? interval.goals.slice(0, 3).map((g) => ({ bridgeId: interval.bridgeId, goalId: g.id, text: g.text }))
      : DEMO_GOALS.map((text) => ({ bridgeId: null, goalId: null, text }));
    event(id, "tool", "continuum.get_interval", { tool: "mcp", target: "get_interval" });
    event(id, "text", interval?.goals?.length ? `Reading your running interval: ${interval.goals.length} session goal${interval.goals.length > 1 ? "s" : ""}.` : "No interval is running; working through the backlog instead.");
    await sleep(2200);
    for (const [i, goal] of goals.entries()) {
      event(id, "tool", `spawn_agent "${goal.text}"`, { tool: "spawn_agent", target: goal.text });
      startWorker(goal.text, { goal: goal.goalId ? goal : null, script: SCRIPTS[i % SCRIPTS.length] });
      await sleep(2600);
    }
    event(id, "text", `${goals.length} worker${goals.length > 1 ? "s are" : " is"} on it. I'll check in when they need you.`);
    setState(id, "idle");
  }

  async function coreSays(text) {
    const id = coreId();
    if (!id) return;
    setState(id, "working");
    await sleep(1400);
    event(id, "text", text);
    setState(id, "idle");
  }

  return {
    async listAgents() {
      return [...agents.values()].map((a) => ({ ...a }));
    },

    subscribe(onMessage) {
      listeners.add(onMessage);
      history.forEach((event) => onMessage({ type: "event", event }));
      if (!started) {
        started = true;
        core();
      }
      return () => listeners.delete(onMessage);
    },

    setInterval(next) {
      interval = next;
    },

    async models() {
      return structuredClone(MODELS);
    },

    // No live GCP here: the picker falls back to the size tiers.
    async computeCatalog() {
      return { available: false, reason: "the pretend brain has no Google Cloud" };
    },

    async settings() {
      const awake = [...agents.values()].some((a) => ["queued", "starting", "working", "stopping"].includes(a.state)) || waiting.size > 0;
      return {
        model: brainModelOf(),
        chosen: choice.brainModel ?? choice.workerModel ?? null,
        brainModel: choice.brainModel ?? null,
        workerModel: choice.workerModel ?? null,
        effective: { brain: brainModelOf(), worker: workerModelOf() },
        tiers: { ...choice.tiers },
        tierNames: TIER_NAMES,
        autoRoute: choice.autoRoute !== false,
        defaults: { model: DEFAULT_MODEL, brain: DEFAULT_MODEL, worker: DEFAULT_MODEL, mode: "fast" },
        mode: choice.mode,
        modes: MODES,
        tools: choice.tools,
        toolsets: TOOLSETS,
        localHelpers: choice.localHelpers === true,
        // Model spend this period, the cap and where it stands (the real brain reports actual spend)
        budget: budgetView(),
        changeable: !awake,
        locked: awake ? "Agents are awake." : null,
      };
    },

    /**
     * The models (as brain-api): `model` sets the brain and workers together;
     * brainModel/workerModel/tiers set each; autoRoute and localHelpers are
     * toggles (no lock). Model changes need nothing awake; idle agents stop.
     */
    async saveSettings({ model, brainModel, workerModel, tiers, autoRoute, localHelpers, budgetCapUsd, budgetCapTokens, mode, tools } = {}) {
      // Toggles change nothing running: no lock
      if (typeof autoRoute === "boolean") choice.autoRoute = autoRoute;
      if (typeof localHelpers === "boolean") choice.localHelpers = localHelpers;
      if (budgetCapUsd !== undefined) {
        if (budgetCapUsd === null) choice.budgetCapUsd = null;
        else {
          const n = Number(budgetCapUsd);
          if (!Number.isFinite(n) || n < 0) throw new Error("The cap must be 0 or more.");
          choice.budgetCapUsd = Math.round(n * 100) / 100;
        }
      } else if (budgetCapTokens !== undefined) {
        if (budgetCapTokens === null) choice.budgetCapUsd = null;
        else {
          const n = Number(budgetCapTokens);
          if (!Number.isFinite(n) || n < 0) throw new Error("The token cap must be 0 or more.");
          choice.budgetCapUsd = Math.round(n * USD_PER_TOKEN * 100) / 100;
        }
      }
      const modelChange = model !== undefined || brainModel !== undefined || workerModel !== undefined || tiers !== undefined || mode !== undefined || tools !== undefined;
      if (!modelChange) return { ...(await this.settings()), stopped: 0 };

      const awake = [...agents.values()].filter((a) => ["queued", "starting", "working", "stopping"].includes(a.state)).length;
      if (awake) throw new Error(`${awake} ${awake === 1 ? "agent is" : "agents are"} awake. Change the model once everything is idle.`);
      if (waiting.size) throw new Error(`${waiting.size} ${waiting.size === 1 ? "request waits" : "requests wait"} for your answer. Answer them first, then change the model.`);
      const ok = (v, what) => {
        if (v === undefined || v === null || v === "") return;
        const m = MODELS.models.find((x) => x.id === v);
        if (!m) throw new Error(`${v} isn't available.`);
        if (m.tools === false) throw new Error(`${m.name} can't use tools, and agents need them (${what}).`);
      };
      [model, brainModel, workerModel, ...(tiers ? Object.values(tiers) : [])].forEach((v) => ok(v, "model"));
      if (mode !== undefined && !MODES.some((x) => x.id === mode)) throw new Error("mode must be fast or thorough.");
      if (tools !== undefined && !TOOLSETS.some((x) => x.id === tools)) throw new Error("tools must be lean or full.");
      const before = JSON.stringify([brainModelOf(), workerModelOf(), choice.tiers, choice.mode, choice.tools]);
      const put = (v) => (v === null || v === "" ? null : v);
      if (model !== undefined) choice.brainModel = choice.workerModel = put(model);
      if (brainModel !== undefined) choice.brainModel = put(brainModel);
      if (workerModel !== undefined) choice.workerModel = put(workerModel);
      if (tiers) for (const [k, v] of Object.entries(tiers)) { if (put(v)) choice.tiers[k] = v; else delete choice.tiers[k]; }
      if (mode !== undefined) choice.mode = mode;
      if (tools !== undefined) choice.tools = tools;
      let stopped = 0;
      if (JSON.stringify([brainModelOf(), workerModelOf(), choice.tiers, choice.mode, choice.tools]) !== before) {
        for (const a of agents.values()) {
          if (a.state !== "idle") continue;
          this.stop(a._id);
          stopped++;
        }
      }
      return { ...(await this.settings()), stopped };
    },

    async spawn(task, { goal = null } = {}) {
      const id = coreId();
      if (id) {
        event(id, "user", `Start a worker: ${task}`);
        event(id, "tool", `spawn_agent "${task}"`, { tool: "spawn_agent", target: task });
      }
      startWorker(task, { goal });
    },

    async retry(agentId) {
      const old = agents.get(agentId);
      if (!old || old.state !== "failed" || old.retriedBy) return;
      const id = coreId();
      if (id) event(id, "tool", `spawn_agent "${old.task}" (retry)`, { tool: "spawn_agent", target: old.task });
      const w = startWorker(old.task, { goal: old.goal, retryOf: agentId, script: { files: ["src/models/bridge.model.js", "test/bridge.model.test.js"] } });
      update(agentId, { retriedBy: w });
    },

    async stop(agentId) {
      stopped.add(agentId);
      setState(agentId, "stopping");
      for (const [eventId, w] of waiting) {
        if (w.agentId !== agentId) continue;
        w.resolve("stop");
        waiting.delete(eventId);
      }
      await sleep(1500);
      setState(agentId, "stopped");
    },

    /** What waits on you: requests not yet answered (as brain-api's /pending). */
    async pending() {
      return history.filter((e) => waiting.has(e._id));
    },

    async reply(agentId, eventId, answer) {
      if (!waiting.has(eventId)) return { alreadyAnswered: true }; // as brain-api: harmless twice
      const said = { approve: "Allowed once", always: "Allowed for this task", deny: "Denied" }[answer] ?? answer;
      event(agentId, "user", said, { replyTo: eventId, answer });
      waiting.get(eventId)?.resolve(answer);
      waiting.delete(eventId);
    },

    async say(text) {
      const id = coreId();
      if (!id) return;
      event(id, "user", text);
      coreSays(`Noted: "${text}". I'll fold it into the plan for the next worker.`);
    },

    /** Stop the current turn but keep the brain warm: it drops to idle ("Ready"). */
    async interrupt() {
      const id = coreId();
      if (!id) return;
      event(id, "state", "Stopped — ready for your next message");
      setState(id, "idle");
    },

    /** An agent interval started (as brain-api): the brain takes its goals, a worker each (the demo can't write the bridge). */
    async startAgentInterval(bridgeId) {
      const id = coreId();
      if (!id) return;
      const goals = interval?.bridgeId === bridgeId ? interval.goals : [];
      event(id, "user", `[Continuum] Run the agent interval (${goals.length} goal${goals.length === 1 ? "" : "s"}).`, { from: "continuum" });
      for (const [i, g] of goals.slice(0, 3).entries()) {
        event(id, "tool", `spawn_agent "${g.text}"`, { tool: "spawn_agent", target: g.text });
        startWorker(g.text, { goal: { bridgeId, goalId: g.id, text: g.text }, script: SCRIPTS[i % SCRIPTS.length] });
        await sleep(1800);
      }
    },
  };
}
