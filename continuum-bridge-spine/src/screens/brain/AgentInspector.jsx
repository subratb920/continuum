import { useEffect, useRef, useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES, STATE_LABEL } from "../../brain/brainTypes";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { agentName, ago, clock, KIND_ICON, useNow } from "./agentDisplay";
import WorkerWork from "./WorkerWork";
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
          {/* Its work: copied into your own folder, its changes, and pushing them to GitHub */}
          <WorkerWork agent={agent} />
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
  const { pending, agents, workers } = useBrain();
  const [only, setOnly] = useState(null); // one worker's requests, or all
  // Oldest first, as asked; a new request goes to the end, nothing moves
  const askers = [...new Set(pending.map((e) => e.agentId))].filter((id) => agents[id]);
  const shown = only && askers.includes(only) ? pending.filter((e) => e.agentId === only) : pending;
  return (
    <div className="inspector-body">
      <p className="brain-hint">Workers ask before they change anything. Take your time: each one waits for your answer, and you can answer in any order.</p>
      {askers.length > 1 && (
        <div className="ask-filter" role="group" aria-label="Show requests from">
          <button type="button" className="ask-filter-chip" aria-pressed={!only || !askers.includes(only)} onClick={() => setOnly(null)}>
            All <span className="brain-tab-count">{pending.length}</span>
          </button>
          {askers.map((id) => (
            <button key={id} type="button" className="ask-filter-chip" aria-pressed={only === id} onClick={() => setOnly(id)}>
              {agentName(agents[id], workers)} <span className="brain-tab-count">{pending.filter((e) => e.agentId === id).length}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length ? shown.map((e) => <AskCard key={e._id} event={e} showWho />) : <p className="brain-empty">Nothing waits on you.</p>}
    </div>
  );
}

/** Options that only mean "I'll type it": the text box under the card does that. */
const OWN_WORDS = /^\s*(type|write|enter|give|add|use)\b.*\b(own|answer|response|details)\b|^\s*(other|custom|something else)\W*$/i;
const DIFF = /^(---|\+\+\+|@@)/m;

/**
 * A permission (approve once, allow for the rest of the task, or deny with a
 * note) or a question (its options, or your own answer), with what you need to
 * judge it: who asks and for which task, exactly what it wants to do (the
 * change or the command), why (what it said last), and when it asked.
 */
function AskCard({ event, showWho = false }) {
  const { agents, workers, events, reply, select, replay } = useBrain();
  const now = useNow(30_000);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState(null); // deny: an optional note for the agent
  const [sending, setSending] = useState(null);
  const [error, setError] = useState("");
  const agent = agents[event.agentId];
  // Real choices only: an agent's "Type your own answer"-style option isn't one (the text box is)
  const choices = (Array.isArray(event.data?.options) ? event.data.options : []).filter((o) => !OWN_WORDS.test(o));
  const detail = typeof event.data?.detail === "string" ? event.data.detail : "";
  // Why: what it said last before asking; and whether it warned it stops soon
  const mine = events.filter((e) => e.agentId === event.agentId);
  const askedAt = mine.findIndex((e) => e._id === event._id);
  const why = (askedAt >= 0 ? mine.slice(0, askedAt) : mine).findLast((e) => e.kind === "text" && !e.data?.waitingLimit);
  const warning = mine.findLast((e) => e.data?.waitingLimit && e.data.request === event._id);

  async function send(a, opts) {
    setSending(a);
    setError("");
    try {
      await reply(event.agentId, event._id, a, opts); // on success the card goes
    } catch (err) {
      setError(err.message || "That didn't go through. Try again.");
      setSending(null);
    }
  }

  return (
    <div className={`ask-card kind-${event.kind}`}>
      <div className="ask-card-top">
        <span aria-hidden="true">{KIND_ICON[event.kind]}</span>
        {showWho && agent ? (
          <button type="button" className="brain-link" onClick={() => select(agent._id)}>{agentName(agent, workers)}</button>
        ) : (
          <span>{event.kind === "permission" ? "Asks to act" : "Asks you"}</span>
        )}
        <time className="event-time" dateTime={event.at} title={clock(event.at)}>asked {ago(event.at, now)}</time>
      </div>
      {showWho && agent?.task && <p className="ask-card-task" title={agent.task}>{agent.task}</p>}
      <p className="ask-card-text">{event.text}</p>
      {detail &&
        (DIFF.test(detail) ? (
          <pre className="ask-diff" aria-label={`The change${event.data?.diff ? ` (${event.data.diff})` : ""}`}>
            {detail.split("\n").map((l, i) => (
              <span key={i} className={l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>
                {l || " "}
              </span>
            ))}
          </pre>
        ) : (
          <pre className="ask-diff ask-command" aria-label="The command">{detail}</pre>
        ))}
      {!detail && event.data?.diff && <p className="ask-card-meta brain-mono">{event.data.target} · {event.data.diff}</p>}
      {why && (
        <p className="ask-card-why">
          <span>Why:</span> {why.text.length > 280 ? `${why.text.slice(0, 279)}…` : why.text}
        </p>
      )}
      {warning && <p className="ask-card-warning" role="status">Stops at {clock(warning.data.stopsAt)} unless you answer.</p>}
      {error && <p className="ask-card-error" role="alert">{error}</p>}
      {!replay.live ? (
        <p className="brain-hint">Replaying — go live to answer.</p>
      ) : event.kind === "permission" ? (
        note === null ? (
          <div className="ask-card-actions wrap">
            <button type="button" className="brain-btn" disabled={!!sending} onClick={() => setNote("")}>Deny…</button>
            <button type="button" className="brain-btn" disabled={!!sending} onClick={() => send("always")} title="Allow this kind of action for the rest of this worker's task">
              {sending === "always" ? "Sending…" : "Allow for this task"}
            </button>
            <button type="button" className="brain-btn is-primary" disabled={!!sending} onClick={() => send("approve")}>
              {sending === "approve" ? "Sending…" : "Approve once"}
            </button>
          </div>
        ) : (
          <form className="ask-card-answer" onSubmit={(e) => (e.preventDefault(), send("deny", { message: note.trim() || undefined }))}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell it why, or what to do instead (optional)" aria-label="A note with your denial" autoFocus />
            <button type="button" className="brain-btn" disabled={!!sending} onClick={() => setNote(null)}>Back</button>
            <button type="submit" className="brain-btn is-danger" disabled={!!sending}>{sending === "deny" ? "Sending…" : "Deny"}</button>
          </form>
        )
      ) : (
        <>
          {choices.length > 0 && (
            <div className="ask-card-actions wrap">
              {choices.map((o) => (
                <button key={o} type="button" className="brain-btn" disabled={!!sending} onClick={() => send(o)}>{sending === o ? "Sending…" : o}</button>
              ))}
            </div>
          )}
          <form className="ask-card-answer" onSubmit={(e) => (e.preventDefault(), answer.trim() && send(answer.trim()))}>
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={choices.length ? "Or answer in your words" : "Type your answer"} aria-label="Your answer" />
            <button type="submit" className="brain-btn is-primary" disabled={!answer.trim() || !!sending}>{sending && !choices.includes(sending) ? "Sending…" : "Send"}</button>
          </form>
        </>
      )}
    </div>
  );
}

function Chat() {
  const { core, coreIds, events, say, replay } = useBrain();
  const [text, setText] = useState("");
  const log = useRef(null);
  // The whole conversation, across the brain's restarts
  const messages = events.filter((e) => coreIds.has(e.agentId) && (e.kind === "user" || e.kind === "text"));

  // To the newest message: only the log scrolls (scrollIntoView would also
  // scroll the screen's own frames, leaving the screen blank)
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length]);

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    say(text.trim());
    setText("");
  }

  return (
    <div className="inspector-body chat">
      <ol className="chat-log" ref={log}>
        {messages.map((m) => (
          <li key={m._id} className={`chat-msg ${m.kind === "user" ? "from-you" : "from-core"}`}>
            <span className="chat-bubble">{m.text}</span>
            <time className="event-time">{clock(m.at)}</time>
          </li>
        ))}
        {!messages.length && <li className="brain-empty">Talk to your brain: it plans and hands work to workers.</li>}
      </ol>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={!replay.live ? "Replaying — go live to send" : BRAIN_IS_MOCK && !core ? "Waking the brain…" : "Message the core…"} disabled={!replay.live || (BRAIN_IS_MOCK && !core)} aria-label="Message the core" />
        <button type="submit" className="brain-btn is-primary" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
