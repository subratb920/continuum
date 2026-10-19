import { useState } from "react";
import { applyResult, changedSince, folderAccess, localFoldersAvailable, pickFolder, savedFolder } from "../brain/localFolder";
import { agentName } from "../screens/brain/agentDisplay";
import "./FinalReview.css";

const STATUS_WORD = { added: "new", deleted: "removed", modified: "changed" };

/** A unified diff, its added and removed lines coloured. */
function Patch({ text }) {
  if (!text) return <p className="review-muted">No diff to show (a binary file).</p>;
  return (
    <pre className="review-patch">
      {text.split("\n").map((l, i) => (
        <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "is-add" : l.startsWith("-") && !l.startsWith("---") ? "is-del" : l.startsWith("@@") ? "is-hunk" : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * The final review of an agent interval that works in your folder: each
 * worker's changes; Approve (the brain merges every branch; a clash it can't
 * settle is yours to choose), or send one worker back with a note. Once
 * merged, the result is written into your folder from here (a file you
 * changed meanwhile is yours to keep or replace).
 */
export default function FinalReview({ review, projectId, workers, brain, onClose, onChanged }) {
  const [open, setOpen] = useState(null); // "agentId:path"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [back, setBack] = useState({ agentId: review.workers[0]?.agentId ?? "", note: "" });
  const [showBack, setShowBack] = useState(false);
  const [mine, setMine] = useState(null); // files changed in your folder meanwhile: { paths, keep: Set }
  const [written, setWritten] = useState(null);

  const nameOf = (id) => {
    const w = workers.find((x) => x._id === id);
    return w ? agentName(w, workers) : `worker ${id.slice(-4)}`;
  };
  const files = review.workers.reduce((n, w) => n + w.files.length, 0);
  const undecided = review.conflicts.filter((c) => !c.choice);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err?.message || "That didn't work. Try again.");
    }
    setBusy(false);
  }

  const approve = () => run(() => brain.approveReview(review.id));
  const choose = (id, choice) => run(() => brain.decideReview(review.id, [{ id, choice }]));
  const sendBack = () => run(async () => {
    await brain.sendBack(review.id, back.agentId, back.note);
    setShowBack(false);
  });

  /** Your folder for this project, with write access (asked from this click). */
  async function folder() {
    if (!localFoldersAvailable()) throw new Error("Writing into your folder needs Chrome or Edge on a computer.");
    const h = (await savedFolder(projectId)) ?? (await pickFolder(projectId, "your project"));
    if (!h) throw new Error("Pick your project's folder to write the result into it.");
    if ((await folderAccess(h, true)) !== "granted") throw new Error(`Allow access to ${h.name} to write the result into it.`);
    return h;
  }

  /** Checks your folder first: files you changed meanwhile are yours to keep or replace. */
  const check = () =>
    run(async () => {
      const h = await folder();
      const paths = await changedSince(h, review.result);
      if (paths.length) setMine({ paths, keep: new Set(paths) });
      else await write(h, new Set());
    });

  async function write(h, keep) {
    const n = await applyResult(h, review.result, keep);
    await brain.reviewApplied(review.id, [...keep]);
    setWritten({ n, folder: h.name, kept: keep.size });
    setMine(null);
  }

  return (
    <div className="modal-backdrop review-backdrop">
      <div className="modal-window final-review" role="dialog" aria-label="Final review">
        <header className="modal-header">
          <h2>Final review</h2>
          <button type="button" className="draft-fold-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section className="modal-body review-body">
          <p className="review-summary">{review.summary}</p>
          <p className="review-muted">
            {review.workers.length} {review.workers.length === 1 ? "worker" : "workers"}, {files} {files === 1 ? "file" : "files"}. Nothing is in your folder yet: it's written after you approve and the branches are merged.
          </p>

          {review.workers.map((w) => (
            <div key={w.agentId} className="review-worker">
              <div className="review-worker-head">
                <strong>{nameOf(w.agentId)}</strong>
                <span className="review-task">{w.task}</span>
                {w.scope.length > 0 && <span className="review-scope">{w.scope.join(", ")}</span>}
              </div>
              <ul className="review-files">
                {w.files.map((f) => {
                  const key = `${w.agentId}:${f.path}`;
                  return (
                    <li key={key}>
                      <button type="button" className="review-file" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                        <span aria-hidden="true">{open === key ? "▾" : "▸"}</span> <span className="review-path">{f.path}</span> <span className={`review-status is-${f.status}`}>{STATUS_WORD[f.status]}</span>
                      </button>
                      {open === key && <Patch text={f.patch} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {review.conflicts.length > 0 && (
            <div className="review-clashes">
              <h3>
                Clashes ({review.conflicts.length - undecided.length} of {review.conflicts.length} settled)
              </h3>
              {review.state === "resolving" && undecided.length > 0 && <p className="review-muted">The brain is settling them. You can choose yourself too.</p>}
              {review.conflicts.map((c) => (
                <div key={c.id} className={`review-clash${c.choice ? " is-settled" : ""}`}>
                  <div className="review-clash-head">
                    <span className="review-path">{c.path}</span>
                    {c.choice ? (
                      <span className="review-decided">
                        {c.choice === "both" ? "both kept" : `${c.choice === "a" ? nameOf(c.a.agentId) : nameOf(c.b.agentId)}'s kept`} · by {c.decidedBy === "you" ? "you" : "the brain"}
                      </span>
                    ) : (
                      <span className="review-needs">your choice</span>
                    )}
                  </div>
                  {c.reason && <p className="review-muted">{c.reason}</p>}
                  <div className="review-clash-sides">
                    {[
                      ["a", c.a],
                      ["b", c.b],
                    ].map(([side, v]) => (
                      <div key={side} className={`review-side${c.choice === side || c.choice === "both" ? " is-kept" : ""}`}>
                        <span className="review-side-who">{nameOf(v.agentId)}</span>
                        <pre>{v.text || "(removed)"}</pre>
                        <button type="button" className="agent-bridge-btn" disabled={busy} onClick={() => choose(c.id, side)}>
                          Keep this
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="review-both" disabled={busy} onClick={() => choose(c.id, "both")}>
                    Keep both (first, then second)
                  </button>
                </div>
              ))}
            </div>
          )}

          {mine && (
            <div className="review-mine">
              <p>You changed these in your folder since the workers started. Keep yours, or take the merged version?</p>
              <ul>
                {mine.paths.map((p) => (
                  <li key={p}>
                    <span className="review-path">{p}</span>
                    <label>
                      <input type="radio" checked={mine.keep.has(p)} onChange={() => setMine((m) => ({ ...m, keep: new Set([...m.keep, p]) }))} /> keep mine
                    </label>
                    <label>
                      <input type="radio" checked={!mine.keep.has(p)} onChange={() => setMine((m) => ({ ...m, keep: new Set([...m.keep].filter((x) => x !== p)) }))} /> take merged
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showBack && (
            <div className="review-back">
              <label>
                Send back
                <select value={back.agentId} onChange={(e) => setBack((b) => ({ ...b, agentId: e.target.value }))}>
                  {review.workers.map((w) => (
                    <option key={w.agentId} value={w.agentId}>
                      {nameOf(w.agentId)}
                    </option>
                  ))}
                </select>
              </label>
              <textarea rows={3} placeholder="What should it change?" value={back.note} onChange={(e) => setBack((b) => ({ ...b, note: e.target.value }))} />
            </div>
          )}

          {written && (
            <p className="review-done">
              ✓ Written into {written.folder}: {written.n} {written.n === 1 ? "file" : "files"}
              {written.kept ? `, ${written.kept} kept as yours` : ""}. The brain finishes the interval.
            </p>
          )}
          {review.state === "applied" && !written && <p className="review-done">✓ Merged into your folder.</p>}
          {review.state === "changes_requested" && <p className="review-muted">Sent back to {nameOf(review.request?.agentId ?? "")}: {review.request?.note}. The brain asks again when it's fixed.</p>}
          {error && <p className="draft-error">{error}</p>}
        </section>

        <footer className="modal-footer draft-footer">
          {review.state === "waiting" && !showBack && (
            <>
              <button type="button" className="agent-bridge-btn" onClick={() => setShowBack(true)} disabled={busy}>
                Request changes…
              </button>
              <button type="button" className="draft-btn-primary" onClick={approve} disabled={busy}>
                {busy ? "Merging…" : "Approve and merge"}
              </button>
            </>
          )}
          {showBack && (
            <>
              <button type="button" className="agent-bridge-btn" onClick={() => setShowBack(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="draft-btn-primary" onClick={sendBack} disabled={busy || !back.note.trim()}>
                Send back
              </button>
            </>
          )}
          {review.state === "ready" && !written && !mine && (
            <button type="button" className="draft-btn-primary" onClick={check} disabled={busy}>
              {busy ? "Writing…" : "Write into my folder"}
            </button>
          )}
          {mine && (
            <button type="button" className="draft-btn-primary" onClick={() => run(async () => write(await folder(), mine.keep))} disabled={busy}>
              Write the rest into my folder
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
