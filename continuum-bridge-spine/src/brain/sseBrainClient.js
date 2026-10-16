/**
 * The brain as brain-api will serve it (not built yet; see continuum-brain/apps/brain-api).
 * Expected endpoints, under VITE_BRAIN_API_URL:
 *   GET  /brain/agents                     → Agent[]
 *   GET  /brain/stream?after=<eventId>&token=<jwt>
 *        SSE: "agent" (Agent) and "event" (AgentEvent) messages, from a change
 *        stream on brain_agents / brain_events; after= catches up first
 *   POST /brain/agents              {task, repo?}       the core starts a worker
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
      let source = null;
      let closed = false;
      const open = () => {
        const q = new URLSearchParams({ token: token() ?? "", ...(last ? { after: last } : {}) });
        source = new EventSource(`${base}/brain/stream?${q}`);
        source.addEventListener("agent", (e) => onMessage({ type: "agent", agent: JSON.parse(e.data) }));
        source.addEventListener("event", (e) => {
          const event = JSON.parse(e.data);
          last = event._id; // reconnects resume after the last one seen
          onMessage({ type: "event", event });
        });
        source.onerror = () => {
          source.close();
          if (!closed) setTimeout(open, 3000);
        };
      };
      open();
      return () => {
        closed = true;
        source?.close();
      };
    },

    spawn: (task, { repo } = {}) => call("POST", "/brain/agents", { task, repo }),
    stop: (agentId) => call("POST", `/brain/agents/${agentId}/stop`),
    reply: (agentId, eventId, answer) => call("POST", `/brain/agents/${agentId}/reply`, { eventId, answer }),
    say: (text) => call("POST", "/brain/core/messages", { text }),
  };
}
