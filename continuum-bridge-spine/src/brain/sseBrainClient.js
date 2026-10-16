import { sharedFeed } from "../utils/sharedFeed";

/**
 * The brain as brain-api will serve it (not built yet; see continuum-brain/apps/brain-api).
 * Expected endpoints, under VITE_BRAIN_API_URL:
 *   GET  /brain/agents                     → Agent[]
 *   GET  /brain/stream?after=<eventId>&token=<jwt>
 *        SSE: "agent" (Agent) and "event" (AgentEvent) messages, from a change
 *        stream on brain_agents / brain_events; after= catches up first
 *   POST /brain/agents              {task, repo?, goal?: {bridgeId, goalId}}
 *        a worker: on that repository, or that interval goal's project; else the core picks
 *   POST /brain/agents/:id/stop
 *   POST /brain/agents/:id/reply    {eventId, answer}   a permission or question
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
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `brain-api ${res.status}`);
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
        source.addEventListener("agent", (e) => emit({ type: "agent", agent: JSON.parse(e.data) }));
        source.addEventListener("event", (e) => {
          const event = JSON.parse(e.data);
          last = event._id; // reconnects resume after the last one seen
          emit({ type: "event", event });
        });
        source.onerror = () => {
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
    stop: (agentId) => call("POST", `/brain/agents/${agentId}/stop`),
    reply: (agentId, eventId, answer) => call("POST", `/brain/agents/${agentId}/reply`, { eventId, answer }),
    say: (text) => call("POST", "/brain/core/messages", { text }),
  };
}
