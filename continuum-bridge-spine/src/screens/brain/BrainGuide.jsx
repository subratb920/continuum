import { useBrain } from "../../brain/brainContext";
import { ACTIVE_STATES } from "../../brain/brainTypes";
import "./brain.css";
import "./brainGuide.css";

/**
 * The Chat screen's left pane: how the brain works, in three small parts —
 * what's happening right now, the loop it runs (animated), and the rules it
 * keeps. The rules and limits are continuum-brain's own (agent-image/agents/
 * core.md and worker.md, brain-orchestrator's config); keep them in step.
 */

/** Workers a person may have awake at once (brain-orchestrator's default). */
const WORKER_LIMIT = 3;

const RULES = [
  ["✋", "The brain never edits code", "It plans and hands the work to workers."],
  ["🔐", "Workers ask before every change", "Each edit or command waits for your yes."],
  ["🙋", "Only you answer", "Approvals and questions are yours, never the brain's."],
  ["🌿", "Never main", "Each worker commits on its own continuum/agent-… branch."],
  ["🚀", "Pushes and deploys are yours", "The brain only proposes them."],
];

const STEPS = ["You ask", "The brain spawns workers", "A worker asks you first", "It commits on its own branch"];

export default function BrainGuide() {
  const brain = useBrain();
  const awake = brain ? brain.workers.filter((w) => ACTIVE_STATES.includes(w.state) && w.state !== "stopping").length : 0;
  const waiting = brain?.pending.length ?? 0;
  const coreState = brain?.core?.state;
  const brainWord = !coreState || coreState === "stopped" ? "Stopped" : coreState === "failed" ? "Failed" : coreState === "idle" ? "Ready" : coreState === "working" ? "Working" : "Starting";

  return (
    <div className="guide">
      <section className="guide-unit">
        <h3 className="guide-head">Right now</h3>
        <dl className="guide-stats">
          <div className="guide-stat">
            <dt>Brain</dt>
            <dd>
              <span className={`guide-led is-${brainWord.toLowerCase()}`} aria-hidden="true" />
              {brainWord}
            </dd>
          </div>
          <div className="guide-stat">
            <dt>Workers</dt>
            <dd>
              <span className="guide-meter" aria-hidden="true">
                {Array.from({ length: WORKER_LIMIT }, (_, i) => (
                  <span key={i} className={i < awake ? "is-on" : ""} />
                ))}
              </span>
              {awake} of {WORKER_LIMIT}
            </dd>
          </div>
          <div className={`guide-stat${waiting ? " is-attention" : ""}`}>
            <dt>Waiting on you</dt>
            <dd>{waiting}</dd>
          </div>
        </dl>
      </section>

      <section className="guide-unit">
        <h3 className="guide-head">The loop</h3>
        <LoopDiagram />
        <ol className="guide-steps">
          {STEPS.map((s, i) => (
            <li key={s} style={{ "--step": i }}>
              <span className="guide-step-n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-unit">
        <h3 className="guide-head">Ground rules</h3>
        <ul className="guide-rules">
          {RULES.map(([icon, rule, why]) => (
            <li key={rule} title={why}>
              <span className="guide-rule-icon" aria-hidden="true">
                {icon}
              </span>
              <span className="guide-rule">{rule}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * You → brain → three workers fan out → one asks you → it commits on its
 * branch; an 8-second loop in step with the numbered steps under it. Still
 * (no moving parts) when the system asks for less motion.
 */
const LOOP = "8s";
function Pulse({ path, from, to }) {
  // Visible only in its part of the loop (from–to, 0–1), travelling the path
  return (
    <circle r="3.5" className="loop-pulse">
      <animateMotion dur={LOOP} repeatCount="indefinite" path={path} keyPoints="0;0;1;1" keyTimes={`0;${from};${to};1`} calcMode="linear" />
      <animate attributeName="opacity" dur={LOOP} repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes={`0;${from};${from + 0.01};${to - 0.01};${to};1`} />
    </circle>
  );
}

function LoopDiagram() {
  const W = [40, 110, 180];
  return (
    <svg className="loop" viewBox="0 0 220 150" role="img" aria-label="You ask the brain; it spawns workers; a worker asks you before a change; it commits on its own branch">
      {/* The links */}
      <path className="loop-link" d="M110 22 L110 62" />
      {W.map((x) => (
        <path key={x} className="loop-link is-flow" d={`M110 78 L${x} 112`} />
      ))}
      <path className="loop-link is-ask" d="M180 112 C 214 80, 200 20, 124 16" />

      {/* Pulses: your message, the spawns, the question back to you */}
      <Pulse path="M110 22 L110 62" from={0} to={0.2} />
      {W.map((x) => (
        <Pulse key={x} path={`M110 78 L${x} 112`} from={0.25} to={0.45} />
      ))}
      <Pulse path="M180 112 C 214 80, 200 20, 124 16" from={0.5} to={0.72} />

      {/* The nodes */}
      <g className="loop-node is-you">
        <circle cx="110" cy="14" r="10" />
        <text x="110" y="18">You</text>
      </g>
      <g className="loop-node is-core">
        <circle cx="110" cy="70" r="13" />
        <text x="110" y="74">✦</text>
      </g>
      {W.map((x, i) => (
        <g key={x} className="loop-node is-worker" style={{ "--i": i }}>
          <circle cx={x} cy="120" r="9" />
        </g>
      ))}
      {/* The commit: a small branch mark under the worker that asked */}
      <g className="loop-commit">
        <path d="M180 132 L180 146" />
        <circle cx="180" cy="146" r="3" />
      </g>
      <text className="loop-label" x="110" y="98">brain</text>
      <text className="loop-label" x="110" y="146">workers</text>
    </svg>
  );
}
