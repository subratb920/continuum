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
    const e = { _id: `e${String(++seq).padStart(7, "0")}`, agentId, at: now(), kind, text, ...(data && { data }) };
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
      ...(state === "starting" && !a.startedAt && { startedAt: now() }),
      ...((state === "stopped" || state === "failed") && { finishedAt: now() }),
    });
    event(id, "state", state, { state });
  }

  function addAgent(kind, task, { repo = null, goal = null, retryOf = null } = {}) {
    const id = `a${String(++agentSeq).padStart(4, "0")}`;
    const a = {
      _id: id,
      kind,
      projectId: repo ? "p-demo" : null,
      repo,
      branch: kind === "worker" ? `continuum/agent-${id}` : null,
      task,
      model: kind === "core" ? "anthropic/claude-sonnet-5-5" : "ollama/qwen3:1.7b-40k",
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
    const ok = await ask(id, "permission", `Edit ${target}`, { tool: "edit", target, diff: "+12 −3" });
    if (!alive(id)) return;
    setState(id, "working");
    if (ok !== "approve") {
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

  function startWorker(task, { goal = null, retryOf = null, script } = {}) {
    const w = addAgent("worker", task, { repo: "subrat/continuum", goal, retryOf });
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

    async reply(agentId, eventId, answer) {
      event(agentId, "user", answer === "approve" ? "Approved" : answer === "deny" ? "Denied" : answer, { replyTo: eventId, answer });
      waiting.get(eventId)?.resolve(answer);
      waiting.delete(eventId);
    },

    async say(text) {
      const id = coreId();
      if (!id) return;
      event(id, "user", text);
      coreSays(`Noted: "${text}". I'll fold it into the plan for the next worker.`);
    },
  };
}
