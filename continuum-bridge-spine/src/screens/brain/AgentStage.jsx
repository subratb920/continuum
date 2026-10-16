import { useBrain, lastEvent } from "../../brain/brainContext";
import { STATE_LABEL } from "../../brain/brainTypes";
import { agentGlyph, agentName, useNow } from "./agentDisplay";
import "./brain.css";

/**
 * Agent Stage (centre): the core in the middle, its workers on a ring around it.
 * Each node moves with its state: breathing when idle, an orbit while working,
 * an amber pulse when it waits on you, a shake when it fails. Work flows along
 * the links from the core; a tool call floats up from the node for a moment.
 * Finished workers rest on the shelf at the bottom. Click a node to inspect it.
 */
const W = 800;
const H = 560;
const CX = W / 2;
const CY = H / 2 - 20;
const RING = 200;
const TOOL_SHOWN_MS = 4500;

export default function AgentStage() {
  const brain = useBrain();
  const now = useNow(500);
  if (!brain) return null;

  const { core, workers, events, pending, selectedId, select } = brain;
  const asking = new Set(pending.map((e) => e.agentId));
  const onRing = workers.filter((w) => w.state !== "stopped");
  const shelf = workers.filter((w) => w.state === "stopped");

  const pos = new Map();
  if (core) pos.set(core._id, [CX, CY]);
  onRing.forEach((w, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(onRing.length, 3);
    pos.set(w._id, [CX + RING * Math.cos(angle), CY + RING * 0.82 * Math.sin(angle)]);
  });
  shelf.forEach((w, i) => pos.set(w._id, [CX - ((shelf.length - 1) * 56) / 2 + i * 56, H - 34]));

  const counts = workers.reduce((c, w) => ((c[w.state] = (c[w.state] ?? 0) + 1), c), {});

  const node = (a) => {
    const [x, y] = pos.get(a._id);
    const isCore = a.kind === "core";
    const small = a.state === "stopped";
    const r = isCore ? 44 : small ? 14 : 28;
    const tool = lastEvent(events, a._id, ["tool"]);
    const showTool = tool && now - new Date(tool.at) < TOOL_SHOWN_MS && a.state === "working";
    const name = agentName(a, workers);
    return (
      <g
        key={a._id}
        className={`agent-node kind-${a.kind} state-${a.state}${asking.has(a._id) ? " asking" : ""}${selectedId === a._id ? " selected" : ""}`}
        transform={`translate(${x} ${y})`}
        role="button"
        tabIndex={0}
        aria-label={`${name}: ${asking.has(a._id) ? "needs you" : STATE_LABEL[a.state]}. ${a.task}`}
        onClick={() => select(selectedId === a._id ? null : a._id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(a._id))}
      >
        <g className="agent-node-body">
          <circle className="agent-halo" r={r + 14} />
          <circle className="agent-orbit" r={r + 7} />
          <circle className="agent-select" r={r + 4} />
          <circle className="agent-core" r={r} />
          <text className="agent-glyph" dy="0.35em" fontSize={isCore ? 26 : small ? 9 : 15}>
            {agentGlyph(a, workers)}
          </text>
          {asking.has(a._id) && (
            <g transform={`translate(${r * 0.72} ${-r * 0.72})`}>
              <g className="agent-badge">
                <circle r="9" />
                <text dy="0.35em">!</text>
              </g>
            </g>
          )}
        </g>
        {!small && (
          <text className="agent-label" y={r + 22}>
            {name} · {asking.has(a._id) ? "needs you" : STATE_LABEL[a.state].toLowerCase()}
          </text>
        )}
        {showTool && (
          <g transform={`translate(0 ${-r - 22})`}>
            {/* keyed by the call: each new one floats up again */}
            <g key={tool._id} className="agent-tool">
              <rect x={-toolWidth(tool.text) / 2} y="-11" width={toolWidth(tool.text)} height="22" rx="11" />
              <text dy="0.35em">{short(tool.text)}</text>
            </g>
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="agent-stage">
      <div className="agent-stage-head">
        <h2 className="agent-stage-title">Agent Stage</h2>
        <ul className="agent-legend">
          {["working", "idle", "failed", "stopped"].map((s) => (
            <li key={s} className={`state-${s}`}>
              <span className="agent-dot" aria-hidden="true" /> {counts[s] ?? 0} {STATE_LABEL[s].toLowerCase()}
            </li>
          ))}
          <li className="asking">
            <span className="agent-dot" aria-hidden="true" /> {pending.length} waiting on you
          </li>
        </ul>
      </div>

      <svg className="agent-stage-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Agents">
        <ellipse className="stage-guide" cx={CX} cy={CY} rx={RING} ry={RING * 0.82} />
        <ellipse className="stage-guide faint" cx={CX} cy={CY} rx={RING * 1.45} ry={RING * 1.2} />
        {shelf.length > 0 && <line className="stage-shelf" x1={CX - 160} x2={CX + 160} y1={H - 12} y2={H - 12} />}

        {core &&
          onRing.map((w) => {
            const [x, y] = pos.get(w._id);
            return (
              <g key={w._id} className={`agent-link state-${w.state}${asking.has(w._id) ? " asking" : ""}`}>
                <line className="agent-link-line" x1={CX} y1={CY} x2={x} y2={y} pathLength="100" />
                <line className="agent-link-flow" x1={CX} y1={CY} x2={x} y2={y} pathLength="100" />
              </g>
            );
          })}

        {[...shelf, ...onRing].map(node)}
        {core && node(core)}

        {!core && (
          <text className="stage-empty" x={CX} y={CY}>
            Waking the brain…
          </text>
        )}
      </svg>
    </div>
  );
}

const short = (t) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);
const toolWidth = (t) => short(t).length * 6.6 + 22;
