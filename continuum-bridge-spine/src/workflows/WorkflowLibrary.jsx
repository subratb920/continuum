import { useWorkflows } from "./workflowModel";
import "./workflows.css";

const STATUS_WORD = { draft: "draft", approved: "approved", running: "running", done: "done", cancelled: "cancelled" };

/**
 * Workflows (left pane): the running interval's workflow on top (a draft
 * waits for your approval), then your templates. Open one on the canvas, or
 * start a new one.
 */
export default function WorkflowLibrary() {
  const w = useWorkflows();
  if (!w?.available) return null;
  const templates = (w.list ?? []).filter((x) => x.kind === "template");
  const row = (x) => (
    <li key={x.id}>
      <button type="button" className={`wf-lib-item${w.draft?.id === x.id ? " is-open" : ""}`} onClick={() => w.open(x.id)}>
        <span className="wf-lib-name">{x.name}</span>
        <span className="wf-lib-meta">
          {x.steps.length} {x.steps.length === 1 ? "step" : "steps"}
          {x.kind === "run" && ` · ${STATUS_WORD[x.status]}`}
          {x.kind === "run" && x.createdBy === "brain" && " · drafted by the brain"}
        </span>
      </button>
    </li>
  );
  return (
    <div className="wf-lib">
      <div className="brain-pane-head">
        <h2 className="brain-pane-title">Workflows</h2>
      </div>
      {w.interval && (
        <section>
          <h3 className="wf-lib-h">This interval</h3>
          {w.run ? (
            <>
              <ul className="wf-lib-list">{row(w.run)}</ul>
              {w.run.status === "draft" && <p className="wf-lib-note">Waits for your approval: open it, change what you like, then Approve.</p>}
            </>
          ) : (
            <p className="brain-hint">{w.interval.kind === "agent" ? "No workflow yet: the brain drafts one when it starts, or use a template below." : "Workflows run in an agent interval (Continuum Brain)."}</p>
          )}
        </section>
      )}
      <section>
        <h3 className="wf-lib-h">Templates</h3>
        {w.list === null && <p className="brain-hint">Loading…</p>}
        {w.list && !templates.length && <p className="brain-hint">None yet. Draw one, or save the brain's draft as a template.</p>}
        <ul className="wf-lib-list">{templates.map(row)}</ul>
        <button type="button" className="brain-btn is-primary" onClick={w.startNew}>
          + New workflow
        </button>
      </section>
    </div>
  );
}
