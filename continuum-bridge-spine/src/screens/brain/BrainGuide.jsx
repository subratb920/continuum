import { useLayoutEffect, useRef, useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { useNavigate } from "react-router-dom";
import { ACTIVE_STATES } from "../../brain/brainTypes";
import { DATA_ENABLED } from "../../data/dataApi";
import { useAuth } from "../../state/authStore";
import { useModelSettings } from "../../brain/useModelSettings";
import ModelPicker from "./ModelPicker";
import "./brain.css";
import "./brainGuide.css";

/**
 * The Chat screen's left pane, in three small parts: what's happening right
 * now, the loop the brain runs (animated), and model building — how Continuum
 * Data takes raw data to a dataset ready to train on (continuum-data's
 * pipeline: docs/phase1-spec.md §4; training itself is still to come).
 * The limits are continuum-brain's defaults (brain-orchestrator config).
 */

/** Workers a person may have awake at once (brain-orchestrator's default). */
const WORKER_LIMIT = 3;


const STEPS = ["You ask", "The brain spawns workers", "A worker asks you first", "It commits on its own branch"];

export default function BrainGuide() {
  const brain = useBrain();
  const { can } = useAuth();
  const navigate = useNavigate();
  const awake = brain ? brain.workers.filter((w) => ACTIVE_STATES.includes(w.state) && w.state !== "stopping").length : 0;
  const waiting = brain?.pending.length ?? 0;
  const coreState = brain?.core?.state;
  const brainWord = !coreState || coreState === "stopped" ? "Stopped" : coreState === "failed" ? "Failed" : coreState === "idle" ? "Ready" : coreState === "working" ? "Working" : "Starting";

  // The "Right now" card flips to a model/tier picker. The card's height follows
  // the face that's showing (the back grows when the picker expands), so the
  // cards below are pushed down smoothly.
  const models = useModelSettings();
  const [flipped, setFlipped] = useState(false);
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const [faceH, setFaceH] = useState(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const el = flipped ? backRef.current : frontRef.current;
      if (el) setFaceH(el.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frontRef.current) ro.observe(frontRef.current);
    if (backRef.current) ro.observe(backRef.current);
    return () => ro.disconnect();
  }, [flipped]);

  return (
    <div className="guide">
      <div className="guide-flip-wrap">
        <div className={`guide-flip${flipped ? " is-flipped" : ""}`} style={faceH ? { height: faceH } : undefined}>
          <section className="guide-unit flip-face flip-front" ref={frontRef} aria-hidden={flipped} {...(flipped ? { inert: "" } : {})}>
            <div className="guide-head-row">
              <h3 className="guide-head">Right now</h3>
              {models.available && (
                <button type="button" className="guide-flip-btn" onClick={() => setFlipped(true)} aria-label="Choose the models" title="Models">
                  <FlipIcon />
                </button>
              )}
            </div>
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
          <section className="guide-unit flip-face flip-back" ref={backRef} aria-hidden={!flipped} {...(flipped ? {} : { inert: "" })}>
            <div className="guide-head-row">
              <h3 className="guide-head">Models</h3>
              <button type="button" className="guide-flip-btn" onClick={() => setFlipped(false)} aria-label="Back to status" title="Back">
                <FlipIcon />
              </button>
            </div>
            <ModelPicker models={models} />
          </section>
        </div>
      </div>

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
        <div className="guide-head-row">
          <h3 className="guide-head">Model building</h3>
          {DATA_ENABLED && can("data") && (
            <button type="button" className="flow-try" onClick={() => navigate("/data")}>
              Open Data ›
            </button>
          )}
        </div>
        <DataPipeline />
        <p className="pipe-kinds">Text · tables · images · audio</p>
      </section>
    </div>
  );
}

/** A flip glyph (two rotating arrows): turns the "Right now" card between its status and the model picker. */
function FlipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.5 1.6v3h-3M4.5 14.4v-3h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

/**
 * Raw data to a training-ready dataset, on a 6-second loop: rows enter from
 * the sources, are profiled, the bad ones are dropped while cleaning (red,
 * falling away), the rest split into train / validation / test lanes and are
 * published; training, the next step, is still to come (dashed).
 */
const PIPE = "6s";
const STAGES = [
  [22, "Sources"],
  [62, "Profile"],
  [102, "Clean"],
  [140, "Split"],
  [176, "Publish"],
];
const LANES = [16, 30, 44]; // train · validation · test
const ROWS = Array.from({ length: 9 }, (_, i) => i);
const DROPPED = new Set([2, 6]);

function DataPipeline() {
  return (
    <svg className="pipe" viewBox="0 0 220 118" role="img" aria-label="Data goes from its sources through profiling and cleaning, is split into train, validation and test, and is published ready to train a model; training is coming">
      <path className="pipe-track" d="M10 30 L140 30" />
      {LANES.map((y) => (
        <path key={y} className="pipe-track is-lane" d={`M140 30 L158 ${y} L188 ${y}`} />
      ))}
      <path className="pipe-track is-next" d="M176 52 L176 84" />

      {ROWS.map((i) => {
        const drop = DROPPED.has(i);
        const path = drop ? "M10 30 L102 30 L110 60" : `M10 30 L140 30 L158 ${LANES[i % 3]} L188 ${LANES[i % 3]}`;
        const begin = `${(i * 6) / ROWS.length}s`;
        return (
          <rect key={i} className={`pipe-row${drop ? " is-dropped" : ""} lane-${i % 3}`} x="-3" y="-2" width="6" height="4" rx="1" opacity="0">
            <animateMotion dur={PIPE} begin={begin} repeatCount="indefinite" path={path} keyPoints="0;1;1" keyTimes={drop ? "0;0.6;1" : "0;0.85;1"} calcMode="linear" />
            <animate attributeName="opacity" dur={PIPE} begin={begin} repeatCount="indefinite" values={drop ? "0;1;1;0;0" : "0;1;1;0;0"} keyTimes={drop ? "0;0.05;0.45;0.6;1" : "0;0.05;0.8;0.88;1"} />
          </rect>
        );
      })}

      {STAGES.map(([x, label], i) => (
        <g key={label} className="pipe-stage" style={{ "--i": i }}>
          <circle cx={x} cy="30" r="5" />
          <text x={x} y={i % 2 ? 62 : 10}>
            {label}
          </text>
        </g>
      ))}
      <text className="pipe-lane-label" x="192" y="16">train</text>
      <text className="pipe-lane-label" x="192" y="30">valid</text>
      <text className="pipe-lane-label" x="192" y="44">test</text>

      {/* The next step: a model trained from the published dataset — not built yet */}
      <g className="pipe-train">
        <rect x="132" y="86" width="84" height="28" rx="7" />
        <text x="174" y="98">Train a model</text>
        <text className="pipe-soon" x="174" y="108">coming soon</text>
      </g>
      <g className="pipe-quality">
        <circle cx="34" cy="100" r="15" />
        <circle className="pipe-quality-arc" cx="34" cy="100" r="15" pathLength="100" />
        <text x="34" y="103">Q</text>
        <text className="pipe-q-label" x="56" y="97">Quality score</text>
        <text className="pipe-q-label is-sub" x="56" y="108">on every version</text>
      </g>
    </svg>
  );
}
