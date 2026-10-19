import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useAuth } from "../state/authStore";
import { BrainContext } from "./brainContext";
import { getBrainClient } from "./brainClient";
import { ASKING_KINDS } from "./brainTypes";
import { useRunningInterval } from "./runningInterval";
import { copyToLocal } from "./localSync";

/**
 * The brain's state, for every signed-in page (the Agents screen, the
 * switcher's badge, the running interval's window): the agents, what they did
 * (their events, oldest first) and what waits on you. Fed by the brain
 * client's stream once signed in; actions go back through the client.
 *
 * Replay: with replay.at set, the screen shows the brain as it was then
 * (agents, states, what waited on you), rebuilt from the events. Actions act
 * on now, so the screen offers them only when live.
 *
 * What waits on you never gets stuck: events are kept in the brain's own
 * order (seq) and only exact repeats are dropped (ids from different writers
 * don't sort in time order). A request leaves the list once anything says it
 * was answered: its reply note, the request itself (answeredAt), the stream's
 * "answered" message, your own answer going through, or the server's list of
 * what still waits (asked again after reconnecting, on coming back to the
 * tab, and every minute while something waits).
 */
const EVENTS_KEPT = 5000;
const RESYNC_MS = 60_000;

const initial = {
  agents: {},
  order: [],
  events: [],
  seen: new Set(),
  // Request id → { answer, at, source }: how it left the list (note, request, stream, you, server)
  replied: {},
  selectedId: null,
  replay: { at: null, playing: false, speed: 4 },
  connected: null, // the live stream: null (not yet), true, false (lost, reconnecting)
};

/** Adds events in the brain's order (seq), skipping ones already here. */
function addEvents(state, list) {
  let { events, seen, replied } = state;
  for (const e of list) {
    if (seen.has(e._id)) continue;
    if (seen === state.seen) seen = new Set(seen);
    seen.add(e._id);
    if (events === state.events) events = [...events];
    // Usually the newest: from the end, before any with a higher seq (events without seq go last, as heard)
    let i = events.length;
    if (e.seq != null) while (i > 0 && events[i - 1].seq != null && events[i - 1].seq > e.seq) i--;
    events.splice(i, 0, e);
    const answer = answerIn(e);
    if (answer && !replied[answer.id]) replied = { ...replied, [answer.id]: answer.how };
  }
  if (events.length > EVENTS_KEPT) {
    const gone = events.slice(0, events.length - EVENTS_KEPT);
    events = events.slice(-EVENTS_KEPT);
    seen = new Set(seen);
    for (const e of gone) seen.delete(e._id);
  }
  return events === state.events ? state : { ...state, events, seen, replied };
}

/** What an event says was answered: a reply note (replyTo), or a request that knows its answer. */
function answerIn(e) {
  if (e.data?.replyTo) return { id: e.data.replyTo, how: { answer: e.data.answer ?? true, at: e.at, source: "note" } };
  if (e.answeredAt && ASKING_KINDS.includes(e.kind)) return { id: e._id, how: { answer: e.answer ?? true, at: e.answeredAt, source: "request" } };
  return null;
}

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
    case "event":
      return addEvents(state, [action.event]);
    // A request got its answer (the stream's "answered", or yours went through)
    case "answered": {
      if (state.replied[action.id]?.source === "note") return state;
      return { ...state, replied: { ...state.replied, [action.id]: { answer: action.answer ?? true, at: action.at ?? new Date().toISOString(), source: action.source } } };
    }
    // The server's list of what still waits: requests on it wait (even ones older than the
    // history here); requests this page had heard of when it asked (seq up to `upToSeq`) and
    // not on it were answered meanwhile. (By seq, not time: the two clocks may differ.)
    case "pending/sync": {
      const next = addEvents(state, action.events);
      const open = new Set(action.events.map((e) => e._id));
      const replied = { ...next.replied };
      let changed = next !== state;
      for (const e of next.events) {
        if (!ASKING_KINDS.includes(e.kind)) continue;
        if (open.has(e._id)) {
          if (replied[e._id] && replied[e._id].source !== "note" && replied[e._id].source !== "request") {
            delete replied[e._id];
            changed = true;
          }
        } else if (!replied[e._id] && e.seq != null && e.seq <= action.upToSeq) {
          replied[e._id] = { answer: null, at: new Date().toISOString(), source: "server" };
          changed = true;
        }
      }
      return changed ? { ...next, replied } : state;
    }
    case "connected":
      return state.connected === action.connected ? state : { ...state, connected: action.connected };
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
    // Your brain: the newest one (a brain that stopped is started anew on your next message)
    core: list.filter((a) => a.kind === "core").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1) ?? null,
    coreIds: new Set(list.filter((a) => a.kind === "core").map((a) => a._id)),
    workers: list.filter((a) => a.kind === "worker"),
    // Permissions and questions not yet answered, from agents still running
    pending: events.filter((e) => ASKING_KINDS.includes(e.kind) && !answered(e._id) && !ended(e.agentId)),
  };
}

export function BrainProvider({ children }) {
  const { status, can } = useAuth();
  // Signed in, with Agents switched on for your role (else nothing connects; the screen says "No feature access")
  const signedIn = status === "authenticated" && can("agents");
  const [state, dispatch] = useReducer(reducer, initial);
  const client = getBrainClient();
  const interval = useRunningInterval();

  // The core plans from the running interval's goals
  useEffect(() => {
    client.setInterval?.(interval);
  }, [client, interval]);

  // A file change you allowed has been made: your own folder for that project follows
  // (only changes from now on: not the history a page replays when it opens)
  // The newest seq heard so far (what the server's list of what waits can be compared with)
  const lastSeq = useRef(0);
  useEffect(() => {
    // Kept in seq order: the last one with a seq has the highest
    for (let i = state.events.length - 1; i >= 0; i--) {
      if (state.events[i].seq == null) continue;
      lastSeq.current = Math.max(lastSeq.current, state.events[i].seq);
      break;
    }
  }, [state.events]);

  const resync = useCallback(() => {
    if (!client.pending) return;
    const upToSeq = lastSeq.current;
    client
      .pending()
      .then((events) => dispatch({ type: "pending/sync", events, upToSeq }))
      .catch(() => {}); // the next try (reconnect, focus, the minute) catches up
  }, [client]);

  // Workers' changes never go into your folder on their own: a folder interval's are written after your final review;
  // a GitHub worker's only when you copy them (Copy again)
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    client.listAgents().then((agents) => live && dispatch({ type: "agents", agents })).catch(() => {});
    const unsubscribe = client.subscribe((m) => {
      if (m.type === "agent") dispatch({ type: "agents", agents: [m.agent] });
      else if (m.type === "answered") dispatch({ type: "answered", id: m.event._id, answer: m.event.answer, at: m.event.answeredAt, source: "stream" });
      else if (m.type === "connected") {
        dispatch({ type: "connected", connected: true });
        resync(); // (re)connected: messages may have been missed meanwhile
      } else if (m.type === "disconnected") dispatch({ type: "connected", connected: false });
      else dispatch({ type: "event", event: m.event });
    });
    resync();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client, signedIn, resync]);

  // The server's list of what waits: on coming back to the tab, and every minute while something waits
  const waiting = view(state, null).pending.length > 0;
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = () => document.visibilityState === "visible" && resync();
    document.addEventListener("visibilitychange", onVisible);
    const timer = waiting ? setInterval(resync, RESYNC_MS) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [signedIn, waiting, resync]);

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
      connected: state.connected,
      replay: { ...state.replay, live: state.replay.at == null, from: first },
      select: (id) => dispatch({ type: "select", id }),
      /** Replay from time t (ms), or null: live. */
      seek: (t) => dispatch({ type: "replay", replay: t == null ? { at: null, playing: false } : { at: t } }),
      playReplay: (play) => dispatch({ type: "replay", replay: { playing: play, ...(play && state.replay.at == null && first != null && { at: first }) } }),
      setReplaySpeed: (s) => dispatch({ type: "replay", replay: { speed: s } }),
      spawn: (task, opts) => client.spawn(task, opts),
      /** An agent interval started: the brain is given its goals and works them to the end. */
      startAgentInterval: (bridgeId) => client.startAgentInterval?.(bridgeId),
      stop: (id) => client.stop(id),
      // brain-api has no retry yet: then a new worker gets the same task
      retry: (id) => (client.retry ? client.retry(id) : client.spawn(state.agents[id].task, { repo: state.agents[id].repo, goal: state.agents[id].goal })),
      /**
       * Your answer to a request. Once it goes through (or it turns out it was
       * answered already, or no longer waits), the request leaves the list at
       * once; on any other failure it stays, and the error is thrown.
       */
      reply: async (agentId, eventId, answer, opts) => {
        try {
          const r = await client.reply(agentId, eventId, answer, opts);
          dispatch({ type: "answered", id: eventId, answer, source: "you" });
          return r;
        } catch (err) {
          if (err.status === 404) {
            dispatch({ type: "answered", id: eventId, answer: null, source: "server" });
            return { gone: true };
          }
          throw err;
        }
      },
      say: (text) => client.say(text),
      // A worker's work: its changes, copying them into your folder, and pushing them to its own branch
      changes: client.changes ? (id) => client.changes(id) : null,
      // Model: the one model your brain and every worker run on (and the models available)
      models: client.models ? () => client.models() : null,
      settings: client.settings ? () => client.settings() : null,
      saveSettings: client.saveSettings ? (changes) => client.saveSettings(changes) : null,
      push: client.push ? (id, message) => client.push(id, message) : null,
      // Workflows (null where this brain has none: the simulated one)
      wf: client.workflows
        ? {
            workflows: (...a) => client.workflows(...a),
            workflowOf: (...a) => client.workflowOf(...a),
            workflow: (...a) => client.workflow(...a),
            saveWorkflow: (...a) => client.saveWorkflow(...a),
            deleteWorkflow: (...a) => client.deleteWorkflow(...a),
            useWorkflow: (...a) => client.useWorkflow(...a),
            approveWorkflow: (...a) => client.approveWorkflow(...a),
            cancelWorkflow: (...a) => client.cancelWorkflow(...a),
            saveAsTemplate: (...a) => client.saveAsTemplate(...a),
            approveStep: (...a) => client.approveStep(...a),
          }
        : null,
      // Your own skills: null where this brain has none (the simulated one)
      skills: client.skills ? () => client.skills() : null,
      saveSkill: client.saveSkill ? (skill) => client.saveSkill(skill) : null,
      deleteSkill: client.deleteSkill ? (id) => client.deleteSkill(id) : null,
      // The final review (works in your folder): null where this brain has none (the simulated one)
      review: client.review ? (bridgeId) => client.review(bridgeId) : null,
      approveReview: client.approveReview ? (id) => client.approveReview(id) : null,
      decideReview: client.decideReview ? (id, decisions) => client.decideReview(id, decisions) : null,
      sendBack: client.sendBack ? (id, agentId, note) => client.sendBack(id, agentId, note) : null,
      reviewApplied: client.reviewApplied ? (id, kept) => client.reviewApplied(id, kept) : null,
      copyToLocal: (agent, opts) => copyToLocal(agent, client, opts),
    };
  }, [state, client, interval]);

  return <BrainContext.Provider value={value}>{children}</BrainContext.Provider>;
}
