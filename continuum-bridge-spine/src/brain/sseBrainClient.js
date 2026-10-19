import { sharedFeed } from "../utils/sharedFeed";

/**
 * The brain, through continuum-api's relay to brain-api (continuum-api/src/brain/routes.js).
 * Endpoints, under VITE_BRAIN_API_URL:
 *   GET  /brain/agents                     → Agent[]
 *   GET  /brain/stream?after=<seq>&token=<jwt>
 *        SSE: "agent" (Agent), "event" (AgentEvent) and "answered" (a request that got its
 *        answer) messages, from change streams on brain_agents / brain_events; after= (the
 *        last event's seq) catches up first
 *   GET  /brain/pending                    → what waits on you (requests not yet answered)
 *   GET  /brain/models                     → the models agents can use, by provider
 *   GET  /brain/settings  PUT /brain/settings {model?, mode?}  the one model all your agents run on, fast or thorough (null model: the
 *        default); only while nothing is awake or waits on you (409 otherwise)
 *   POST /brain/agents              {task, repo?, goal?: {bridgeId, goalId}}  (on your one model)
 *        a worker: on that repository, or that interval goal's project; else the core picks
 *   POST /brain/agents/:id/stop
 *   POST /brain/agents/:id/reply    {eventId, answer, message?}   a permission or question
 *        (answered already: 200 with alreadyAnswered)
 *   POST /brain/core/messages       {text}
 * EventSource can't send headers, so the stream takes the token as a query parameter.
 *
 * @returns {import("./brainTypes").BrainClient}
 */
export function createSseBrainClient(base = import.meta.env.VITE_BRAIN_API_URL) {
  const token = () => localStorage.getItem("continuum_token");

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      // The status and code go along: a 404 on an answer means the request no longer waits
      throw Object.assign(new Error(body?.error || `brain-api ${res.status}`), { status: res.status, code: body?.code ?? null });
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    listAgents: () => call("GET", "/brain/agents"),

    subscribe(onMessage, { after } = {}) {
      let last = after ?? null;
      // One feed for every Continuum tab in this browser (one tab holds it; utils/sharedFeed)
      return sharedFeed("continuum-brain-feed", (emit) => {
      let source = null;
      let retry = null;
      let closed = false;
      const open = () => {
        const q = new URLSearchParams({ token: token() ?? "", ...(last ? { after: last } : {}) });
        source = new EventSource(`${base}/brain/stream?${q}`);
        // (Re)connected: what waits on you is asked again, in case anything was missed meanwhile
        source.addEventListener("open", () => emit({ type: "connected" }));
        source.addEventListener("agent", (e) => emit({ type: "agent", agent: JSON.parse(e.data) }));
        source.addEventListener("answered", (e) => emit({ type: "answered", event: JSON.parse(e.data) }));
        source.addEventListener("event", (e) => {
          const event = JSON.parse(e.data);
          // Reconnects resume after the last one seen, by the brain's order (its seq)
          if (event.seq != null && (typeof last !== "number" || event.seq > last)) last = event.seq;
          else if (event.seq == null && last == null) last = event._id;
          emit({ type: "event", event });
        });
        source.onerror = () => {
          emit({ type: "disconnected" }); // the screen says so until it's back
          source.close();
          if (!closed) retry = setTimeout(open, 3000);
        };
      };
      open();
      return () => {
        closed = true;
        clearTimeout(retry);
        source?.close();
      };
      }, onMessage);
    },

    // A goal is sent as its ids: brain-api takes its text (and the project) from Continuum
    spawn: (task, { repo, goal } = {}) => call("POST", "/brain/agents", { task, repo, ...(goal ? { goal: { bridgeId: goal.bridgeId, goalId: goal.goalId } } : {}) }),
    models: () => call("GET", "/brain/models"),
    settings: () => call("GET", "/brain/settings"),
    saveSettings: (changes) => call("PUT", "/brain/settings", changes),
    stop: (agentId) => call("POST", `/brain/agents/${agentId}/stop`),
    // A worker's changes on its branch, one file of its copy, and pushing them to its own branch on GitHub
    changes: (agentId) => call("GET", `/brain/agents/${agentId}/changes`),
    file: (agentId, path) => call("GET", `/brain/agents/${agentId}/file?path=${encodeURIComponent(path)}`),
    push: (agentId, message) => call("POST", `/brain/agents/${agentId}/push`, message ? { message } : {}),
    // The final review of an agent interval that works in your folder
    review: async (bridgeId) => (await call("GET", `/brain/reviews?bridgeId=${encodeURIComponent(bridgeId)}`))?.review ?? null,
    approveReview: (id) => call("POST", `/brain/reviews/${id}/approvals`),
    decideReview: (id, decisions) => call("POST", `/brain/reviews/${id}/decisions`, { decisions }),
    sendBack: (id, agentId, note) => call("POST", `/brain/reviews/${id}/changes`, { agentId, note }),
    reviewApplied: (id, kept) => call("POST", `/brain/reviews/${id}/applied`, { kept }),
    pending: () => call("GET", "/brain/pending"),
    reply: (agentId, eventId, answer, { message } = {}) => call("POST", `/brain/agents/${agentId}/reply`, { eventId, answer, ...(message ? { message } : {}) }),
    say: (text) => call("POST", "/brain/core/messages", { text }),
    // An agent interval started: the brain is given its goals and works them to the end
    startAgentInterval: (bridgeId) => call("POST", "/brain/core/agent-interval", { bridgeId }),
  };
}
