import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBrain } from "../../brain/brainContext";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { useAuth } from "../../state/authStore";
import { agentName, clock } from "./agentDisplay";
import { CHAT_DRAFT_EVENT } from "./BrainFlows";
import { brainStatus } from "./brainStatus";
import "./brain.css";

// The conversation itself: your words and the brain's replies, as bubbles
const CONV_KINDS = new Set(["user", "text"]);
// Plus what the brain and its workers *do*, as a quiet activity trail between
// replies, so the chat shows the work going on (not a dead screen) — and says
// so the moment something fails
const FEED_KINDS = new Set(["user", "text", "tool", "state", "error"]);

// A plain-words name for each tool the brain calls, so the trail reads like
// steps, not code. Anything unlisted falls back to the tool's own name.
const TOOL_SAID = {
  continuum_list_projects: "Looked over your projects",
  continuum_get_project: "Opened the project",
  continuum_get_interval: "Checked which project is active",
  continuum_list_bridges: "Checked the project's sessions",
  continuum_spawn_agent: "Started a worker",
  continuum_message_agent: "Messaged a worker",
  continuum_plan_goal: "Planned the goal into tasks",
  continuum_request_approval: "Asked for your approval",
};

const cut = (s, n = 300) => (s && s.length > n ? `${s.slice(0, n)}…` : s || "");

/** A tool call in plain words (its own name if we have no nicer one). */
function toolSaid(ev) {
  const name = ev.data?.tool || ev.text || "";
  if (TOOL_SAID[name]) return TOOL_SAID[name];
  const bare = String(name).replace(/\s*\(failed\)\s*$/, "").replace(/^continuum_/, "").replace(/_/g, " ");
  return bare ? bare[0].toUpperCase() + bare.slice(1) : "Worked";
}

/**
 * One activity line from a tool / state / error event: a label, the detail
 * (for a failure, the actual error so you can see what went wrong), and a tone.
 * `who` prefixes a worker's lines so you can tell them from the brain's.
 */
function activityOf(ev, who) {
  const tag = who ? `${who} · ` : "";
  if (ev.kind === "error") return { tone: "err", label: `${tag}${cut(ev.text, 200)}`, detail: cut(ev.data?.error, 400) };
  if (ev.kind === "state") return { tone: "muted", label: `${tag}${ev.text}`, detail: "" };
  if (ev.kind === "text") return { tone: "muted", label: tag || "Note", detail: cut(ev.text, 400) };
  // a tool call
  const failed = ev.data?.status === "error";
  const target = ev.data?.target ? ` (${cut(ev.data.target, 60)})` : "";
  return {
    tone: failed ? "err" : "ok",
    label: `${tag}${toolSaid(ev)}${target}`,
    detail: failed ? cut(ev.data?.error, 400) : "",
  };
}

/**
 * The Chat screen: talking to the brain, in the console's middle column
 * (phones: the whole screen under the tabs). What you send shows at once
 * ("Sending…") and stays until the brain's own record of it arrives; if it
 * can't be sent (the brain is starting, the connection is down) you see why,
 * and can send it again. Questions and approvals waiting on you are one click
 * away, on the Agents screen.
 */
export default function BrainChat() {
  const brain = useBrain();
  const { can, access } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [outbox, setOutbox] = useState([]); // [{ id, text, at, error? }]
  const [stopErr, setStopErr] = useState(null); // when a Stop couldn't go through
  const log = useRef(null);
  const box = useRef(null);
  // The feed: your conversation with the brain, plus the brain's and its
  // workers' activity in between (so the screen isn't dead while it works)
  const feed = brain
    ? brain.events.filter((e) => FEED_KINDS.has(e.kind) && (brain.coreIds.has(e.agentId) || brain.agents[e.agentId]?.kind === "worker"))
    : [];
  // Just the conversation bubbles (your words + the brain's replies), for the
  // "Sending…" match and the empty state
  const messages = feed.filter((e) => brain?.coreIds.has(e.agentId) && CONV_KINDS.has(e.kind));
  // Sent, not yet heard back: the brain's record of the same words since it was sent replaces it
  const waiting = outbox.filter((o) => o.error || !messages.some((m) => m.kind === "user" && m.text === o.text && Date.parse(m.at) >= o.at - 60_000));

  // To the newest message: only the log scrolls (scrollIntoView would also
  // scroll the screen's own frames, leaving the screen blank)
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [feed.length, waiting.length]);

  // "Try it" on a sample flow: its message in the box, ready to edit or send
  useEffect(() => {
    const take = (e) => {
      setText(e.detail ?? "");
      box.current?.focus();
    };
    window.addEventListener(CHAT_DRAFT_EVENT, take);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, take);
  }, []);

  // The input grows with what's typed (its CSS caps it), and is one line again once sent
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(44, el.scrollHeight + 2)}px`;
  }, [text]);

  if (!brain) return null;
  const { core, say, interrupt, replay, connected, pending } = brain;
  const status = brainStatus(core, connected);
  // Sending needs "Run agents"; an API from before that feature existed (it isn't in its list) leaves it to Agents itself
  const runKnown = access?.allFeatures?.some((f) => f.id === "agents_run") ?? true;
  const mayRun = runKnown ? can("agents_run") : can("agents");
  const off = !mayRun || !replay.live || (BRAIN_IS_MOCK && !core);
  // A turn is in flight to stop (pulse covers queued/starting/working); idle shows no Stop
  const canStop = mayRun && replay.live && status.pulse === true && !!interrupt;

  // Stop what the brain is doing now; it stays warm (Ready), so you can send a corrected prompt
  async function stopBrain() {
    setStopErr(null);
    try {
      await interrupt();
    } catch (err) {
      setStopErr(err.message || "That couldn't be stopped — try again.");
    }
  }

  async function send(words, id = crypto.randomUUID()) {
    setOutbox((o) => [...o.filter((x) => x.id !== id), { id, text: words, at: Date.now() }]);
    try {
      await say(words);
    } catch (err) {
      const why = err.code === "BRAIN_BUSY" || err.status === 409 ? err.message || "The brain is starting; send it again when it's ready." : err.message || "It couldn't be sent.";
      setOutbox((o) => o.map((x) => (x.id === id ? { ...x, error: why } : x)));
    }
  }

  function submit(e) {
    e?.preventDefault();
    if (!text.trim() || off) return;
    send(text.trim());
    setText("");
  }

  return (
    <section className="brain-chat" aria-label="Chat with the brain">
      {/* The middle pane's place, framed by the side panes' shade as on every other screen */}
      <div className="brain-chat-panel">
      <div className="brain-chat-top">
        <span className={`brain-chat-pill is-${status.tone}${status.pulse ? " is-pulsing" : ""}${status.stop ? " is-stopped" : ""}`} role="status">
          <span className="brain-chat-dot" aria-hidden="true" />
          <span className="brain-chat-what">Brain</span>
          {status.label}
        </span>
        <span className="brain-chat-hint">{status.hint}</span>
        {pending.length > 0 && (
          <button type="button" className="brain-link brain-chat-waiting" onClick={() => navigate("/brain", { state: { inspectorTab: "approvals" } })}>
            {pending.length} waiting on you · Open Agents ›
          </button>
        )}
      </div>

      <ol className="chat-log brain-chat-log" ref={log}>
        {feed.map((m) => {
          const isCore = brain.coreIds.has(m.agentId);
          // A note from Continuum to the brain (an agent interval started, a worker finished): a quiet line, not yours
          if (m.data?.from === "continuum") {
            return (
              <li key={m._id} className="chat-system">
                {m.text.replace(/^\[Continuum\]\s*/, "")}
              </li>
            );
          }
          // Your words and the brain's own replies are the conversation itself
          if (isCore && CONV_KINDS.has(m.kind)) {
            return (
              <li key={m._id} className={`chat-msg ${m.kind === "user" ? "from-you" : "from-core"}`}>
                <span className="chat-bubble">{m.text}</span>
                <time className="event-time">{clock(m.at)}</time>
              </li>
            );
          }
          // Everything else is the work going on: a quiet step, or a failure in red
          const who = isCore ? "" : agentName(brain.agents[m.agentId], brain.workers);
          const a = activityOf(m, who);
          return (
            <li key={m._id} className={`chat-activity is-${a.tone}`}>
              <span className="chat-activity-dot" aria-hidden="true" />
              <span className="chat-activity-body">
                <span className="chat-activity-label">{a.label}</span>
                {a.detail && <span className="chat-activity-detail">{a.detail}</span>}
              </span>
              <time className="event-time">{clock(m.at)}</time>
            </li>
          );
        })}
        {waiting.map((o) => (
          <li key={o.id} className={`chat-msg from-you${o.error ? " failed" : " sending"}`}>
            <span className="chat-bubble">{o.text}</span>
            {o.error ? (
              <span className="chat-error" role="alert">
                {o.error}{" "}
                <button type="button" className="brain-link" onClick={() => send(o.text, o.id)}>
                  Retry
                </button>
              </span>
            ) : (
              <span className="event-time">Sending…</span>
            )}
          </li>
        ))}
        {!feed.length && !waiting.length && <li className="brain-empty">Ask the brain for something: it plans the work and hands it to workers.</li>}
      </ol>

      {stopErr && <p className="chat-error brain-chat-stoperr" role="alert">{stopErr}</p>}
      <form className="chat-input brain-chat-input" onSubmit={submit}>
        <textarea
          ref={box}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          // Enter sends; Shift+Enter starts a new line
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={!mayRun ? "Your role can read this chat but not send to it" : !replay.live ? "Replaying — go live to send" : BRAIN_IS_MOCK && !core ? "Waking the brain…" : "Message the brain…"}
          disabled={off}
          aria-label="Message the brain"
        />
        {canStop && (
          <button type="button" className="brain-btn is-danger brain-chat-stop" onClick={stopBrain} title="Stop what the brain is doing now — it stays ready for a new message">
            <span className="brain-chat-stop-glyph" aria-hidden="true" /> Stop
          </button>
        )}
        <button type="submit" className="brain-btn is-primary" disabled={off || !text.trim()}>
          Send
        </button>
      </form>
      </div>
    </section>
  );
}
