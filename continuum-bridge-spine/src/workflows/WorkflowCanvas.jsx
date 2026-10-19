import { useCallback, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { agentName } from "../screens/brain/agentDisplay";
import { KIND, newStep, useWorkflows } from "./workflowModel";
import "./workflows.css";

const MINIMAP_COLOR = { task: "#6366f1", approval: "#d97706", review: "#0ea5e9", final: "#16a34a" };
const STATE_WORD = { waiting: "waiting", ready: "ready", working: "working", done: "done", failed: "failed" };

/** One step on the canvas: its kind, title, state and worker; an approval that's ready has its button. */
function StepNode({ data }) {
  const { step, worker, onApprove, live } = data;
  return (
    <div className={`wf-node kind-${step.kind} state-${step.state}${live ? " is-live" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="wf-node-head">
        <span className="wf-node-icon" aria-hidden="true">
          {KIND[step.kind].icon}
        </span>
        <span className="wf-node-title">{step.title || KIND[step.kind].label}</span>
      </div>
      <div className="wf-node-meta">
        <span className="wf-node-kind">{KIND[step.kind].label}</span>
        {live && <span className={`wf-node-state state-${step.state}`}>{STATE_WORD[step.state]}</span>}
      </div>
      {worker && <div className="wf-node-worker">● {worker}</div>}
      {step.scope?.length > 0 && <div className="wf-node-scope">{step.scope.join(", ")}</div>}
      {live && step.kind === "approval" && step.state === "ready" && (
        <button type="button" className="wf-node-approve nodrag" onClick={() => onApprove(step.id)}>
          Approve
        </button>
      )}
      {step.kind !== "final" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
const nodeTypes = { step: StepNode };

/**
 * The workflow as a free graph: drag steps, drag from a step's right handle
 * to another's left to say it waits for it, select and press Delete to
 * remove. A running workflow shows each step's state and worker; arrows into
 * working steps flow.
 */
export default function WorkflowCanvas() {
  const w = useWorkflows();
  const d = w?.draft;
  const live = !!d && d.kind === "run" && d.status !== "draft";

  const nodes = useMemo(
    () =>
      (d?.steps ?? []).map((s) => {
        const agent = s.agentId ? w.workers.find((x) => x._id === s.agentId) : null;
        return {
          id: s.id,
          type: "step",
          position: { x: s.x, y: s.y },
          selected: w.selected === s.id,
          draggable: w.editable,
          data: { step: s, live, worker: agent ? agentName(agent, w.workers) : s.agentId ? `worker ${s.agentId.slice(-4)}` : null, onApprove: w.approveStep },
        };
      }),
    [d, w.selected, w.editable, w.workers, w.approveStep, live]
  );
  const edges = useMemo(
    () =>
      (d?.edges ?? []).map((e) => {
        const to = d.steps.find((s) => s.id === e.to);
        const flowing = live && (to?.state === "working" || to?.state === "ready");
        return { id: `${e.from}>${e.to}`, source: e.from, target: e.to, animated: flowing, className: flowing ? "is-flowing" : undefined, markerEnd: { type: MarkerType.ArrowClosed } };
      }),
    [d, live]
  );

  const onNodesChange = useCallback(
    (changes) => {
      for (const c of changes) if (c.type === "select" && c.selected) w.setSelected(c.id);
      if (!w.editable) return;
      const moved = changes.filter((c) => c.type === "position" && c.position);
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (!moved.length && !removed.length) return;
      w.change((x) => {
        const placed = applyNodeChanges(moved, x.steps.map((s) => ({ id: s.id, position: { x: s.x, y: s.y } })));
        for (const s of x.steps) {
          const p = placed.find((n) => n.id === s.id)?.position;
          if (p) Object.assign(s, { x: Math.round(p.x), y: Math.round(p.y) });
        }
        x.steps = x.steps.filter((s) => !removed.includes(s.id));
        x.edges = x.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to));
        return x;
      });
      if (removed.includes(w.selected)) w.setSelected(null);
    },
    [w]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      if (!w.editable) return;
      const kept = applyEdgeChanges(changes, edges);
      if (kept.length === edges.length) return;
      w.change((x) => ({ ...x, edges: kept.map((e) => ({ from: e.source, to: e.target })) }));
    },
    [w, edges]
  );

  const onConnect = useCallback(
    ({ source, target }) => {
      if (!w.editable || !source || !target || source === target) return;
      w.change((x) => (x.edges.some((e) => e.from === source && e.to === target) ? x : { ...x, edges: [...x.edges, { from: source, to: target }] }));
    },
    [w]
  );

  if (!w?.available) return <div className="wf-empty">Workflows need Continuum's brain (it isn't connected here).</div>;
  if (!d) return <div className="wf-empty">Open a workflow on the left, or start a new one.</div>;

  const add = (kind) => {
    const right = Math.max(80, ...d.steps.map((s) => s.x + 260));
    const s = newStep(kind, d.steps, Math.min(right, 1400), 140);
    w.change((x) => ({ ...x, steps: [...x.steps, s] }));
    w.setSelected(s.id);
  };

  return (
    <div className="wf-canvas">
      {w.editable && (
        <div className="wf-toolbar">
          {Object.entries(KIND).map(([k, v]) => (
            <button key={k} type="button" className="brain-btn" onClick={() => add(k)} disabled={k === "final" && d.steps.some((s) => s.kind === "final")}>
              {v.icon} {v.label}
            </button>
          ))}
          <span className="wf-toolbar-hint">Drag from a step's right edge to another to make it wait for it. Select and press Delete to remove.</span>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => w.setSelected(null)}
        nodesConnectable={w.editable}
        edgesFocusable={w.editable}
        deleteKeyCode={w.editable ? ["Backspace", "Delete"] : null}
        colorMode={document.documentElement.dataset.theme === "light" ? "light" : "dark"}
        fitView
        fitViewOptions={{ padding: 0.25 }}
      >
        <Background gap={20} />
        <MiniMap pannable zoomable className="wf-minimap" style={{ width: 150, height: 96 }} nodeColor={(n) => MINIMAP_COLOR[n.data?.step?.kind] ?? "#888"} maskColor="rgb(0 0 0 / 0.25)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
