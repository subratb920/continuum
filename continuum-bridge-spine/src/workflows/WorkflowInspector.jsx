import { useState } from "react";
import { KIND, useWorkflows } from "./workflowModel";
import "./workflows.css";

/**
 * Inspector (right pane): the selected step (title, what to do, its files,
 * its check, its goal), or the workflow itself with what you can do now:
 * save, approve (a draft run), use for this interval (a template), save as
 * a template, cancel or delete.
 */
export default function WorkflowInspector() {
  const w = useWorkflows();
  const [confirm, setConfirm] = useState(null); // "delete" | "cancel"
  if (!w?.available || !w.draft) return <div className="wf-insp brain-hint">Select a workflow, or a step on the canvas.</div>;
  const d = w.draft;
  const step = d.steps.find((s) => s.id === w.selected) ?? null;
  const ro = !w.editable;
  const setStep = (patch) => w.change((x) => ({ ...x, steps: x.steps.map((s) => (s.id === step.id ? { ...s, ...patch } : s)) }));
  const waitsFor = step ? d.edges.filter((e) => e.to === step.id).map((e) => d.steps.find((s) => s.id === e.from)?.title ?? e.from) : [];
  const goals = w.interval?.goals ?? [];

  return (
    <div className="wf-insp">
      {step ? (
        <div className="wf-form">
          <div className="wf-insp-head">
            <span className="wf-node-icon">{KIND[step.kind].icon}</span> {KIND[step.kind].label}
            <button type="button" className="brain-link" onClick={() => w.setSelected(null)}>
              ← Workflow
            </button>
          </div>
          <label>
            Title
            <input value={step.title} readOnly={ro} onChange={(e) => setStep({ title: e.target.value })} />
          </label>
          {step.kind === "task" && (
            <>
              <label>
                What to do
                <textarea rows={6} value={step.instructions} readOnly={ro} onChange={(e) => setStep({ instructions: e.target.value })} placeholder="What the worker changes, and where." />
              </label>
              <label>
                Its files (one per line)
                <textarea rows={3} value={step.scope.join("\n")} readOnly={ro} onChange={(e) => setStep({ scope: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} placeholder={"continuum-api/src/brain/\nREADME.md"} />
                <span className="brain-hint">Only this worker changes these; workers that run at the same time must not share files.</span>
              </label>
              <label>
                How to check it
                <input value={step.check} readOnly={ro} onChange={(e) => setStep({ check: e.target.value })} placeholder="cd continuum-api && npm test" />
              </label>
            </>
          )}
          {(step.kind === "review" || step.kind === "approval") && (
            <label>
              {step.kind === "review" ? "What the brain looks at" : "What you approve"}
              <textarea rows={4} value={step.instructions} readOnly={ro} onChange={(e) => setStep({ instructions: e.target.value })} />
            </label>
          )}
          {goals.length > 0 && step.kind === "task" && (
            <label>
              Goal
              <select value={step.goalId ?? ""} disabled={ro} onChange={(e) => setStep({ goalId: e.target.value || null })}>
                <option value="">The interval's first goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.text}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="brain-hint">{waitsFor.length ? `Waits for: ${waitsFor.join(", ")}.` : "Starts first (nothing before it)."}</p>
          {step.note && <p className="brain-hint">Note: {step.note}</p>}
          {d.kind === "run" && d.status === "running" && step.kind === "approval" && step.state === "ready" && (
            <button type="button" className="brain-btn is-primary" onClick={() => w.approveStep(step.id)} disabled={w.busy}>
              Approve this step
            </button>
          )}
        </div>
      ) : (
        <div className="wf-form">
          <label>
            Name
            <input value={d.name} readOnly={ro} onChange={(e) => w.change((x) => ({ ...x, name: e.target.value }))} />
          </label>
          <label>
            Description
            <textarea rows={3} value={d.description} readOnly={ro} onChange={(e) => w.change((x) => ({ ...x, description: e.target.value }))} />
          </label>
          <p className="brain-hint">
            {d.kind === "template" ? "A template: use it for an agent interval, or let the brain start from it." : `This interval's workflow · ${d.status}${d.createdBy === "brain" ? " · drafted by the brain" : ""}.`} {d.steps.length} steps, {d.edges.length} arrows.
          </p>
          <div className="wf-actions">
            {w.editable && (
              <button type="button" className="brain-btn" onClick={w.save} disabled={w.busy || !w.dirty}>
                {w.busy ? "Saving…" : w.dirty ? "Save" : "Saved"}
              </button>
            )}
            {d.kind === "run" && d.status === "draft" && (
              <button type="button" className="brain-btn is-primary" onClick={w.approve} disabled={w.busy || w.dirty} title={w.dirty ? "Save your changes first" : undefined}>
                Approve and start
              </button>
            )}
            {d.kind === "template" && d.id && w.interval?.kind === "agent" && (
              <button type="button" className="brain-btn is-primary" onClick={w.useForInterval} disabled={w.busy || w.dirty}>
                Use for this interval
              </button>
            )}
            {d.id && d.kind === "run" && (
              <button type="button" className="brain-btn" onClick={w.saveAsTemplate} disabled={w.busy}>
                Save as template
              </button>
            )}
            {d.id && d.kind === "run" && ["draft", "running", "approved"].includes(d.status) && (
              <button type="button" className="brain-btn" onClick={() => setConfirm("cancel")} disabled={w.busy}>
                Cancel run…
              </button>
            )}
            {d.id && (d.kind === "template" || ["draft", "done", "cancelled"].includes(d.status)) && (
              <button type="button" className="brain-btn wf-danger" onClick={() => setConfirm("delete")} disabled={w.busy}>
                Delete…
              </button>
            )}
          </div>
          {confirm && (
            <div className="wf-confirm">
              <p>{confirm === "delete" ? `Delete ${d.name}? It can't be brought back.` : "Cancel this workflow? The brain starts no more of its steps; workers already working carry on until you stop them."}</p>
              <button type="button" className="brain-btn" onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button type="button" className="brain-btn wf-danger" onClick={() => (setConfirm(null), confirm === "delete" ? w.remove() : w.cancel())}>
                Yes, {confirm === "delete" ? "delete" : "cancel"} it
              </button>
            </div>
          )}
        </div>
      )}
      {w.error && (
        <p className="model-settings-error" role="alert">
          {w.error}
        </p>
      )}
    </div>
  );
}
