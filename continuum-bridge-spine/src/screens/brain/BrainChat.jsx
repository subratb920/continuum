import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBrain } from "../../brain/brainContext";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { useAuth } from "../../state/authStore";
import { clock } from "./agentDisplay";
import "./brain.css";

/**
 * The Chat screen: talking to the brain, in the console's middle column
 * (phones: the whole screen under the tabs). What you send shows at once
 * ("Sending…") and stays until the brain's own record of it arrives; if it
 * can't be sent (the brain is starting, the connection is down) you see why,
 * and can send it again. Questions and approvals waiting on you are one click
 * away, on the Agents screen.
 */
/**
 * Where the brain stands: its state in the usual words (Stopped is Stopped),
 * a colour, and what happens next: { tone, label, hint, pulse? }.
 */
function brainStatus(core, connected) {
  if (connected === false) return { tone: "amber", label: "Reconnecting", hint: "Messages show once the connection is back." };
  switch (core?.state) {
    case "queued":
    case "starting":
      return { tone: "amber", label: "Starting", pulse: true, hint: "Takes about a minute the first time." };
    case "working":
      return { tone: "violet", label: "Working", pulse: true, hint: "Replies appear here as it goes." };
    case "idle":
      return { tone: "green", label: "Ready", hint: "Send a message to give it work." };
    case "stopping":
      return { tone: "grey", label: "Stopping", stop: true, hint: "It can be started again with a message." };
    case "failed":
      return { tone: "red", label: "Failed", hint: "Send a message to start it again." };
    default:
      return { tone: "grey", label: "Stopped", stop: true, hint: "Sending a message starts it." };
  }
}

export default function BrainChat() {
  const brain = useBrain();
  const { can, access } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [outbox, setOutbox] = useState([]); // [{ id, text, at, error? }]
  const log = useRef(null);
  const box = useRef(null);
  const messages = brain ? brain.events.filter((e) => brain.coreIds.has(e.agentId) && (e.kind === "user" || e.kind === "text")) : [];
  // Sent, not yet heard back: the brain's record of the same words since it was sent replaces it
  const waiting = outbox.filter((o) => o.error || !messages.some((m) => m.kind === "user" && m.text === o.text && Date.parse(m.at) >= o.at - 60_000));

  // To the newest message: only the log scrolls (scrollIntoView would also
  // scroll the screen's own frames, leaving the screen blank)
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length, waiting.length]);

  // The input grows with what's typed (its CSS caps it), and is one line again once sent
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(44, el.scrollHeight + 2)}px`;
  }, [text]);

  if (!brain) return null;
  const { core, say, replay, connected, pending } = brain;
  const status = brainStatus(core, connected);
  // Sending needs "Run agents"; an API from before that feature existed (it isn't in its list) leaves it to Agents itself
  const runKnown = access?.allFeatures?.some((f) => f.id === "agents_run") ?? true;
  const mayRun = runKnown ? can("agents_run") : can("agents");
  const off = !mayRun || !replay.live || (BRAIN_IS_MOCK && !core);

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
        {messages.map((m) => (
          <li key={m._id} className={`chat-msg ${m.kind === "user" ? "from-you" : "from-core"}`}>
            <span className="chat-bubble">{m.text}</span>
            <time className="event-time">{clock(m.at)}</time>
          </li>
        ))}
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
        {!messages.length && !waiting.length && <li className="brain-empty">Ask the brain for something: it plans the work and hands it to workers.</li>}
      </ol>

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
        <button type="submit" className="brain-btn is-primary" disabled={off || !text.trim()}>
          Send
        </button>
      </form>
      </div>
    </section>
  );
}
