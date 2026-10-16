import { useEffect, useMemo, useReducer } from "react";
import { useAuth } from "../state/authStore";
import { BrainContext } from "./brainContext";
import { getBrainClient } from "./brainClient";
import { ASKING_KINDS } from "./brainTypes";
import { useRunningInterval } from "./runningInterval";

/**
 * The brain's state, for every signed-in page (the Agents screen, the
 * switcher's badge, the running interval's window): the agents, what they did
 * (their events, oldest first) and what waits on you. Fed by the brain
 * client's stream once signed in; actions go back through the client.
 *
 * Replay: with replay.at set, the screen shows the brain as it was then
 * (agents, states, what waited on you), rebuilt from the events. Actions act
 * on now, so the screen offers them only when live.
 */
const EVENTS_KEPT = 5000;

const initial = {
  agents: {},
  order: [],
  events: [],
  replied: {},
  selectedId: null,
  replay: { at: null, playing: false, speed: 4 },
};

function reducer(state, action) {
  switch (action.type) {
    case "agents": {
      const agents = { ...state.agents };
      const order = [...state.order];
      for (const a of action.agents) {
        if (!agents[a._id]) order.push(a._id);
        agents[a._id] = { ...agents[a._id], ...a };
      }
      return { ...state, agents, order };
    }
    case "event": {
      const e = action.event;
      if (state.events.length && state.events[state.events.length - 1]._id >= e._id) return state; // seen (catch-up overlap)
      const events = state.events.length >= EVENTS_KEPT ? [...state.events.slice(-EVENTS_KEPT + 1), e] : [...state.events, e];
      const replied = e.data?.replyTo ? { ...state.replied, [e.data.replyTo]: { answer: e.data.answer ?? true, at: e.at } } : state.replied;
      return { ...state, events, replied };
    }
    case "select":
      return { ...state, selectedId: action.id };
    case "replay":
      return { ...state, replay: { ...state.replay, ...action.replay } };
    default:
      return state;
  }
}

/** The agents as they were at time t (ms): from their creation and state events. */
function agentsAt(state, t) {
  const last = {};
  for (const e of state.events) {
    if (Date.parse(e.at) > t) break;
    if (e.kind === "state") last[e.agentId] = e;
  }
  const out = {};
  for (const id of state.order) {
    const a = state.agents[id];
    if (Date.parse(a.createdAt) > t) continue;
    const s = last[id]?.data?.state ?? "queued";
    const ended = s === "stopped" || s === "failed";
    out[id] = {
      ...a,
      state: s,
      finishedAt: ended ? last[id].at : null,
      error: s === "failed" ? a.error : null,
      retriedBy: a.retriedBy && state.agents[a.retriedBy] && Date.parse(state.agents[a.retriedBy].createdAt) <= t ? a.retriedBy : null,
    };
  }
  return out;
}

/** The view the screen draws: everything now, or as it was at t. */
function view(state, t) {
  const agents = t == null ? state.agents : agentsAt(state, t);
  const events = t == null ? state.events : state.events.filter((e) => Date.parse(e.at) <= t);
  const answered = (id) => (t == null ? id in state.replied : state.replied[id] && Date.parse(state.replied[id].at) <= t);
  const ended = (id) => ["stopped", "failed"].includes(agents[id]?.state);
  const list = state.order.filter((id) => agents[id]).map((id) => agents[id]);
  return {
    agents,
    events,
    agentList: list,
    core: list.find((a) => a.kind === "core") ?? null,
    workers: list.filter((a) => a.kind === "worker"),
    // Permissions and questions not yet answered, from agents still running
    pending: events.filter((e) => ASKING_KINDS.includes(e.kind) && !answered(e._id) && !ended(e.agentId)),
  };
}

export function BrainProvider({ children }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const [state, dispatch] = useReducer(reducer, initial);
  const client = getBrainClient();
  const interval = useRunningInterval();

  // The core plans from the running interval's goals
  useEffect(() => {
    client.setInterval?.(interval);
  }, [client, interval]);

  useEffect(() => {
    if (!signedIn) return;
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
  }, [client, signedIn]);

  // Replay playing: time moves on at replay.speed, and goes live at the end
  const { at, playing, speed } = state.replay;
  useEffect(() => {
    if (!playing || at == null) return;
    const step = 100;
    const timer = setInterval(() => {
      const next = at + step * speed;
      dispatch({ type: "replay", replay: next >= Date.now() ? { at: null, playing: false } : { at: next } });
    }, step);
    return () => clearInterval(timer);
  }, [playing, at, speed]);

  const value = useMemo(() => {
    const live = view(state, null);
    const shown = state.replay.at == null ? live : view(state, state.replay.at);
    const first = state.events[0] ? Date.parse(state.events[0].at) : null;
    return {
      ...shown,
      interval, // the running interval: { bridgeId, goals } or null
      livePending: live.pending,
      live, // now, even while replaying (what the running interval records)
      selectedId: state.selectedId,
      replay: { ...state.replay, live: state.replay.at == null, from: first },
      select: (id) => dispatch({ type: "select", id }),
      /** Replay from time t (ms), or null: live. */
      seek: (t) => dispatch({ type: "replay", replay: t == null ? { at: null, playing: false } : { at: t } }),
      playReplay: (play) => dispatch({ type: "replay", replay: { playing: play, ...(play && state.replay.at == null && first != null && { at: first }) } }),
      setReplaySpeed: (s) => dispatch({ type: "replay", replay: { speed: s } }),
      spawn: (task, opts) => client.spawn(task, opts),
      stop: (id) => client.stop(id),
      // brain-api has no retry yet: then a new worker gets the same task
      retry: (id) => (client.retry ? client.retry(id) : client.spawn(state.agents[id].task, { repo: state.agents[id].repo, goal: state.agents[id].goal })),
      reply: (agentId, eventId, answer) => client.reply(agentId, eventId, answer),
      say: (text) => client.say(text),
    };
  }, [state, client, interval]);

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}
