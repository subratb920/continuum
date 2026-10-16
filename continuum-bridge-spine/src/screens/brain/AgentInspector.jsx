import { useEffect, useRef, useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES, STATE_LABEL } from "../../brain/brainTypes";
import { agentName, clock, KIND_ICON } from "./agentDisplay";
import "./brain.css";

/**
 * Inspector (right): Activity (the selected agent's events, or everyone's),
 * Approvals (permissions and questions waiting on you) and Chat (with the core).
 */
export default function AgentInspector() {
  const brain = useBrain();
  const [tab, setTab] = useState("activity");
  if (!brain) return null;
  const { pending } = brain;

  const TABS = [
    ["activity", "Activity"],
    ["approvals", "Approvals", pending.length],
    ["chat", "Chat"],
  ];

  return (
    <div className="agent-inspector">
      <div className="brain-tabs" role="tablist" aria-label="Inspector">
        {TABS.map(([id, label, count]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} className="brain-tab" onClick={() => setTab(id)}>
            {label}
            {count > 0 && <span className="brain-tab-count">{count}</span>}
          </button>
        ))}
      </div>
      {tab === "activity" && <Activity />}
      {tab === "approvals" && <Approvals />}
      {tab === "chat" && <Chat />}
    </div>
  );
}

function Activity() {
  const { agents, workers, events, pending, selectedId, select, stop, retry, replay } = useBrain();
  const agent = selectedId ? agents[selectedId] : null;
  const shown = (agent ? events.filter((e) => e.agentId === agent._id) : events).filter((e) => e.kind !== "state" || agent).slice(-150).reverse();
  const asks = agent ? pending.filter((e) => e.agentId === agent._id) : [];

  return (
    <div className="inspector-body">
      {agent ? (
        <div className={`inspector-agent state-${agent.state}`}>
          <div className="inspector-agent-top">
            <span className="agent-dot" aria-hidden="true" />
            <strong>{agentName(agent, workers)}</strong>
            <span className="agent-row-state">{STATE_LABEL[agent.state]}</span>
            <button type="button" className="brain-link" onClick={() => select(null)}>All agents</button>
          </div>
          <p className="inspector-task">{agent.task}</p>
          <dl className="inspector-facts">
            {agent.goal && (<><dt>Goal</dt><dd className="inspector-goal" title={agent.goal.text}>◎ {agent.goal.text}</dd></>)}
            {agent.repo && (<><dt>Repo</dt><dd>{agent.repo}</dd></>)}
            {agent.branch && (<><dt>Branch</dt><dd className="brain-mono">{agent.branch}</dd></>)}
            <dt>Model</dt><dd className="brain-mono">{agent.model}</dd>
            {agent.error && (<><dt>Error</dt><dd className="inspector-error">{agent.error.message}</dd></>)}
          </dl>
          {replay.live && agent.kind === "worker" && ACTIVE_STATES.includes(agent.state) && agent.state !== "stopping" && (
            <button type="button" className="brain-btn is-danger" onClick={() => stop(agent._id)}>Stop worker</button>
          )}
          {replay.live && agent.state === "failed" && !agent.retriedBy && (
            <button type="button" className="brain-btn is-primary" onClick={() => retry(agent._id)} title="A fresh worker on the same task (and goal)">
              ↻ Retry with a new worker
            </button>
          )}
          {agent.retriedBy && (
            <button type="button" className="brain-link" onClick={() => select(agent.retriedBy)}>
              Retried by {agentName(agents[agent.retriedBy], workers)} →
            </button>
          )}
        </div>
      ) : (
        <p className="brain-hint">Every agent's activity, newest first. Pick an agent on the stage to follow just that one.</p>
      )}

      {asks.map((e) => <AskCard key={e._id} event={e} />)}

      <ol className="event-feed">
        {shown.map((e) => (
          <li key={e._id} className={`event kind-${e.kind}`}>
            <span className="event-icon" aria-hidden="true">{KIND_ICON[e.kind]}</span>
            <span className="event-main">
              {!agent && <span className="event-who">{agentName(agents[e.agentId], workers)}</span>}
              <span className="event-text">{e.kind === "state" ? `→ ${STATE_LABEL[e.text] ?? e.text}` : e.text}</span>
            </span>
            <time className="event-time">{clock(e.at)}</time>
          </li>
        ))}
        {!shown.length && <li className="brain-empty">Nothing yet.</li>}
      </ol>
    </div>
  );
}

function Approvals() {
  const { pending } = useBrain();
  return (
    <div className="inspector-body">
      <p className="brain-hint">Workers ask before they change anything, and ask when they're unsure.</p>
      {pending.length ? pending.map((e) => <AskCard key={e._id} event={e} showWho />) : <p className="brain-empty">Nothing waits on you.</p>}
    </div>
  );
}

/** A permission (approve / deny) or a question (its options, or your own answer). */
function AskCard({ event, showWho = false }) {
  const { agents, workers, reply, select, replay } = useBrain();
  const [answer, setAnswer] = useState("");
  const agent = agents[event.agentId];
  const send = (a) => reply(event.agentId, event._id, a);

  return (
    <div className={`ask-card kind-${event.kind}`}>
      <div className="ask-card-top">
        <span aria-hidden="true">{KIND_ICON[event.kind]}</span>
        {showWho ? (
          <button type="button" className="brain-link" onClick={() => select(agent._id)}>{agentName(agent, workers)}</button>
        ) : (
          <span>{event.kind === "permission" ? "Asks to act" : "Asks you"}</span>
        )}
        <time className="event-time">{clock(event.at)}</time>
      </div>
      <p className="ask-card-text">{event.text}</p>
      {event.data?.diff && <p className="ask-card-meta brain-mono">{event.data.target} · {event.data.diff}</p>}
      {!replay.live ? (
        <p className="brain-hint">Replaying — go live to answer.</p>
      ) : event.kind === "permission" ? (
        <div className="ask-card-actions">
          <button type="button" className="brain-btn" onClick={() => send("deny")}>Deny</button>
          <button type="button" className="brain-btn is-primary" onClick={() => send("approve")}>Approve</button>
        </div>
      ) : (
        <>
          {Array.isArray(event.data?.options) && (
            <div className="ask-card-actions wrap">
              {event.data.options.map((o) => (
                <button key={o} type="button" className="brain-btn" onClick={() => send(o)}>{o}</button>
              ))}
            </div>
          )}
          <form className="ask-card-answer" onSubmit={(e) => (e.preventDefault(), answer.trim() && send(answer.trim()))}>
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or answer in your words" aria-label="Your answer" />
            <button type="submit" className="brain-btn is-primary" disabled={!answer.trim()}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}

function Chat() {
  const { core, events, say, replay } = useBrain();
  const [text, setText] = useState("");
  const end = useRef(null);
  const messages = core ? events.filter((e) => e.agentId === core._id && (e.kind === "user" || e.kind === "text")) : [];

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    say(text.trim());
    setText("");
  }

  return (
    <div className="inspector-body chat">
      <ol className="chat-log">
        {messages.map((m) => (
          <li key={m._id} className={`chat-msg ${m.kind === "user" ? "from-you" : "from-core"}`}>
            <span className="chat-bubble">{m.text}</span>
            <time className="event-time">{clock(m.at)}</time>
          </li>
        ))}
        {!messages.length && <li className="brain-empty">Talk to your brain: it plans and hands work to workers.</li>}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={!replay.live ? "Replaying — go live to send" : core ? "Message the core…" : "Waking the brain…"} disabled={!core || !replay.live} aria-label="Message the core" />
        <button type="submit" className="brain-btn is-primary" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
