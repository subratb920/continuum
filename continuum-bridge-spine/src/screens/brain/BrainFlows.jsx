import "./brain.css";
import "./brainGuide.css";

/**
 * The Chat screen's right pane: sample flows (each a small looping picture of
 * how the brain hands the work out; "Try it" puts its message in the chat
 * box) and what a worker is (sizes and limits: continuum-brain's defaults).
 */

export const CHAT_DRAFT_EVENT = "brain-chat:draft";

const FLOWS = [
  {
    id: "one",
    title: "One fix",
    line: "One worker, asking before each change.",
    prompt: "Find why the tests fail in my project and fix it. Tell me what you changed.",
  },
  {
    id: "split",
    title: "Split the work",
    line: "Two workers at once, each on its own branch.",
    prompt: "In my project, have one worker add tests for the API while another updates the README.",
  },
  {
    id: "plan",
    title: "Plan first",
    line: "The brain asks you first, then starts one.",
    prompt: "Help me plan the next feature for my project before any work starts.",
  },
];

const SIZES = [
  ["Small", "1 CPU · 2 GB", "default"],
  ["Standard", "2 CPU · 4 GB", ""],
  ["Large", "4 CPU · 8 GB", ""],
];

const LIMITS = [
  ["3", "awake at once"],
  ["30 min", "idle, then it stops"],
  ["60 min", "of work per task, waiting on you not counted"],
  ["Out of memory", "restarts one size up, work kept"],
];

function useDraft() {
  return (text) => window.dispatchEvent(new CustomEvent(CHAT_DRAFT_EVENT, { detail: text }));
}

export default function BrainFlows() {
  const draft = useDraft();
  return (
    <div className="guide">
      <section className="guide-unit">
        <h3 className="guide-head">Try a flow</h3>
        <ul className="flows">
          {FLOWS.map((f) => (
            <li key={f.id} className="flow">
              <MiniFlow kind={f.id} />
              <div className="flow-text">
                <span className="flow-title-row">
                  <span className="flow-title">{f.title}</span>
                  <button type="button" className="flow-try" onClick={() => draft(f.prompt)} title={`Puts this in the message box: “${f.prompt}”`}>
                    Try it ›
                  </button>
                </span>
                <span className="flow-line">{f.line}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="guide-unit">
        <h3 className="guide-head">Workers</h3>
        <div className="guide-workers">
        <ul className="guide-sizes">
          {SIZES.map(([name, spec, note]) => (
            <li key={name} className="guide-size">
              <span className="guide-size-name">{name}</span>
              <span className="guide-size-spec">{spec}</span>
              {note && <span className="guide-size-note">{note}</span>}
            </li>
          ))}
        </ul>
        <dl className="guide-limits">
          {LIMITS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="guide-foot">All run on the brain's one model (Agents › Models).</p>
        </div>
      </section>
    </div>
  );
}

/** A flow in 120×44: the brain on the left, its workers to the right, a dot travelling the links on a loop. */
function MiniFlow({ kind }) {
  const ys = kind === "split" ? [12, 32] : [22];
  return (
    <svg className={`mini mini-${kind}`} viewBox="0 0 120 44" aria-hidden="true">
      <circle className="mini-core" cx="16" cy="22" r="8" />
      {kind === "plan" ? (
        <>
          {/* A question back to you, then one worker */}
          <path className="mini-link is-ask" d="M24 18 C 44 2, 64 2, 76 12" />
          <circle className="mini-you" cx="80" cy="14" r="5" />
          <path className="mini-link" d="M24 26 L96 30" />
          <circle className="mini-worker is-late" cx="102" cy="30" r="6" />
          <circle className="mini-dot is-ask" r="2.5">
            <animateMotion dur="4s" repeatCount="indefinite" path="M24 18 C 44 2, 64 2, 76 12" keyPoints="0;1;1" keyTimes="0;0.4;1" calcMode="linear" />
          </circle>
        </>
      ) : (
        ys.map((y, i) => (
          <g key={y}>
            <path className="mini-link" d={`M24 22 L94 ${y}`} />
            <circle className="mini-worker" cx="102" cy={y} r="6" style={{ "--i": i }} />
            <circle className="mini-dot" r="2.5">
              <animateMotion dur="3s" begin={`${i * 0.4}s`} repeatCount="indefinite" path={`M24 22 L94 ${y}`} keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear" />
            </circle>
          </g>
        ))
      )}
    </svg>
  );
}
