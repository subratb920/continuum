import { useEffect, useMemo, useReducer } from "react";
import { BrainContext } from "./brainContext";
import { getBrainClient } from "./brainClient";
import { ASKING_KINDS } from "./brainTypes";

/**
 * The brain's live state for the Agents screen (and the switcher's badge):
 * the agents, what they did (their events, newest last) and what waits on you.
 * Fed by the brain client's stream; actions go back through the client.
 */
const EVENTS_KEPT = 1500;

const initial = { agents: {}, order: [], events: [], replied: {}, selectedId: null, connected: false };

function reducer(state, action) {
  switch (action.type) {
    case "agents": {
      const agents = { ...state.agents };
      const order = [...state.order];
      for (const a of action.agents) {
        if (!agents[a._id]) order.push(a._id);
        agents[a._id] = { ...agents[a._id], ...a };
      }
      return { ...state, agents, order, connected: true };
    }
    case "event": {
      const e = action.event;
      if (state.events.length && state.events[state.events.length - 1]._id >= e._id) return state; // seen (catch-up overlap)
      const events = state.events.length >= EVENTS_KEPT ? [...state.events.slice(-EVENTS_KEPT + 1), e] : [...state.events, e];
      const replied = e.data?.replyTo ? { ...state.replied, [e.data.replyTo]: e.data.answer ?? true } : state.replied;
      return { ...state, events, replied };
    }
    case "select":
      return { ...state, selectedId: action.id };
    default:
      return state;
  }
}

export function BrainProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const client = getBrainClient();

  useEffect(() => {
    let live = true;
    client.listAgents().then((agents) => live && dispatch({ type: "agents", agents })).catch(() => {});
    const unsubscribe = client.subscribe((m) => {
      if (m.type === "agent") dispatch({ type: "agents", agents: [m.agent] });
      else dispatch({ type: "event", event: m.event });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client]);

  const value = useMemo(() => {
    const agents = state.order.map((id) => state.agents[id]);
    const ended = (id) => ["stopped", "failed"].includes(state.agents[id]?.state);
    // Permissions and questions not yet answered, from agents still running
    const pending = state.events.filter((e) => ASKING_KINDS.includes(e.kind) && !(e._id in state.replied) && !ended(e.agentId));
    return {
      ...state,
      agentList: agents,
      // Your brain: the newest one (a brain that stopped is started anew on your next message)
      core: agents.filter((a) => a.kind === "core").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1) ?? null,
      coreIds: new Set(agents.filter((a) => a.kind === "core").map((a) => a._id)),
      workers: agents.filter((a) => a.kind === "worker"),
      pending,
      select: (id) => dispatch({ type: "select", id }),
      spawn: (task) => client.spawn(task),
      stop: (id) => client.stop(id),
      reply: (agentId, eventId, answer) => client.reply(agentId, eventId, answer),
      say: (text) => client.say(text),
    };
  }, [state, client]);

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}
