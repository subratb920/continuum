/**
 * A pretend brain, until brain-api serves the real one (VITE_BRAIN_MODE=mock,
 * the default). It plays what the orchestrator will report: the core plans and
 * starts workers; workers read, edit and test, ask before changing anything,
 * ask questions, finish or fail. Answers, spawns and stops all work.
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

  const now = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, (ms * (0.7 + Math.random() * 0.6)) / speed));
  const emit = (m) => listeners.forEach((fn) => fn(m));

  function event(agentId, kind, text, data) {
    const e = { _id: `e${String(++seq).padStart(7, "0")}`, agentId, at: now(), kind, text, ...(data && { data }) };
    if (history.push(e) > 1500) history.shift();
    emit({ type: "event", event: e });
    return e;
  }

  function setState(id, state, extra = {}) {
    const a = agents.get(id);
    if (!a || a.state === state) return;
    Object.assign(a, { state, ...extra });
    if (state === "starting") a.startedAt ??= now();
    if (state === "stopped" || state === "failed") a.finishedAt = now();
    emit({ type: "agent", agent: { ...a } });
    event(id, "state", state, { state });
  }

  function addAgent(kind, task, repo = null) {
    const n = ++agentSeq;
    const id = `a${String(n).padStart(4, "0")}`;
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
      event(id, "text", "Tests pass. Committed to my branch.");
    }
    await sleep(1200);
    setState(id, "idle");
  }

  async function core() {
    const id = addAgent("core", "Your brain: plans the interval's goals and hands them to workers");
    await boot(id);
    event(id, "text", "Reading the active interval: 3 session goals.");
    event(id, "tool", "continuum.get_interval", { tool: "mcp", target: "get_interval" });
    await sleep(2200);
    const plans = [
      ["Add a goal-progress endpoint to the bridge API", { files: ["src/routes/bridges.js", "src/models/bridge.model.js", "src/routes/bridges.js"] }],
      ["Show goal progress on the Bridge Spine", { files: ["src/components/BridgeSpine.jsx", "src/components/BridgeSpine.css"], question: { text: "Progress as a bar or as a fraction (2/3)?", options: ["a bar", "a fraction"] } }],
      ["Migrate bridge goals to the new status field", { files: ["src/models/bridge.model.js"], fails: true }],
    ];
    for (const [task, script] of plans) {
      event(id, "tool", `spawn_agent "${task}"`, { tool: "spawn_agent", target: task });
      const w = addAgent("worker", task, "subrat/continuum");
      worker(w, script);
      await sleep(2600);
    }
    event(id, "text", "Three workers are on it. I'll check in when they need you.");
    setState(id, "idle");
  }

  async function coreSays(text) {
    const id = [...agents.values()].find((a) => a.kind === "core")?._id;
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

    async spawn(task) {
      const coreId = [...agents.values()].find((a) => a.kind === "core")?._id;
      if (coreId) {
        event(coreId, "user", `Start a worker: ${task}`);
        event(coreId, "tool", `spawn_agent "${task}"`, { tool: "spawn_agent", target: task });
      }
      const w = addAgent("worker", task, "subrat/continuum");
      worker(w, { files: ["src/App.jsx", "src/api.js"] });
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
      const id = [...agents.values()].find((a) => a.kind === "core")?._id;
      if (!id) return;
      event(id, "user", text);
      coreSays(`Noted: "${text}". I'll fold it into the plan for the next worker.`);
    },
  };
}
