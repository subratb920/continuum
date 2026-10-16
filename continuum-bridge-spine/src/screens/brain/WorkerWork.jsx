import { useEffect, useState } from "react";
import { useBrain } from "../../brain/brainContext";
import { BRAIN_IS_MOCK } from "../../brain/brainClient";
import { folderKey, localFoldersAvailable, pickFolder, savedFolder } from "../../brain/localFolder";
import { useLocalCopy, WRITE_TOOLS } from "../../brain/localSync";
import { clock } from "./agentDisplay";

/**
 * A worker's work, under its details in the inspector:
 * - your folder: where the changes you allow are copied (picked once per
 *   project; the browser asks to allow edits there);
 * - its changes on its branch;
 * - once it has changes, whether to push them to GitHub: its own branch
 *   (never main), with a link to open a pull request. Only you push.
 */
export default function WorkerWork({ agent }) {
  const { changes, push, copyToLocal, events, replay } = useBrain();
  const copy = useLocalCopy(agent._id);
  const [folder, setFolder] = useState(null);
  const [files, setFiles] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState("");
  const [later, setLater] = useState(false);
  const running = agent.state === "working" || agent.state === "idle";

  // Its last file change and its last push (from its events)
  const mine = events.filter((e) => e.agentId === agent._id);
  const lastWrite = mine.filter((e) => e.kind === "tool" && e.data?.status === "completed" && WRITE_TOOLS.includes(e.data?.tool)).at(-1);
  const lastPush = mine.filter((e) => e.kind === "user" && e.data?.pushed).at(-1);
  const pushedSinceChange = lastPush && (!lastWrite || lastPush._id > lastWrite._id);

  useEffect(() => {
    let live = true;
    savedFolder(folderKey(agent)).then((h) => live && setFolder(h));
    return () => {
      live = false;
    };
  }, [agent, copy?.status]);

  // Its changes: when it starts, and after each change it makes
  const changeKey = lastWrite?._id ?? "none";
  useEffect(() => {
    if (!running || !changes) return undefined;
    let live = true;
    changes(agent._id)
      .then((c) => live && setFiles(c.files))
      .catch(() => live && setFiles(null));
    return () => {
      live = false;
    };
  }, [agent._id, running, changes, changeKey]);

  if (BRAIN_IS_MOCK || agent.kind !== "worker" || !agent.repo || !changes) return null;

  async function pick() {
    const h = await pickFolder(folderKey(agent), agent.repo).catch((err) => (setPushError(err.message), null));
    if (h) {
      setFolder(h);
      if (running) copyToLocal(agent, { ask: true });
    }
  }

  async function doPush() {
    setPushing(true);
    setPushError("");
    try {
      await push(agent._id);
    } catch (err) {
      setPushError(err?.message ?? String(err));
    }
    setPushing(false);
  }

  const n = files?.length ?? 0;
  return (
    <div className="worker-work">
      {localFoldersAvailable() ? (
        <div className="worker-folder">
          <span className="worker-work-label">Your folder</span>
          {!folder ? (
            <button type="button" className="brain-btn" onClick={pick}>
              Pick your folder for {agent.repo.split("/")[1]}
            </button>
          ) : copy?.status === "needs-access" ? (
            <button type="button" className="brain-btn" onClick={() => copyToLocal(agent, { ask: true })}>
              Allow access to {folder.name}
            </button>
          ) : (
            <span className="worker-folder-name">
              📁 {folder.name}
              {copy?.status === "copying" && " · copying…"}
              {copy?.status === "copied" && ` · ✓ ${copy.files} ${copy.files === 1 ? "file" : "files"} copied at ${clock(copy.at)}`}
              {copy?.status === "error" && ` · couldn't copy: ${copy.error}`}
              {running && n > 0 && copy?.status !== "copying" && (
                <button type="button" className="brain-link" onClick={() => copyToLocal(agent, { ask: true })}>
                  Copy again
                </button>
              )}
              <button type="button" className="brain-link" onClick={pick}>
                Change
              </button>
            </span>
          )}
        </div>
      ) : (
        <p className="brain-hint">Your own folder needs Chrome or Edge on a computer; the changes stay on its branch.</p>
      )}

      {running && files && (
        <div className="worker-changes">
          <span className="worker-work-label">Changes on {agent.branch}</span>
          {n === 0 ? (
            <p className="brain-hint">No changes yet.</p>
          ) : (
            <ul>
              {files.map((f) => (
                <li key={f.file} className={`change-${f.status}`}>
                  <span className="brain-mono">{f.file}</span>
                  <span className="change-size">
                    {f.status === "added" ? "new" : f.status === "deleted" ? "removed" : ""} +{f.additions} −{f.deletions}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lastPush && (
        <p className="worker-pushed">
          ✓ On GitHub:{" "}
          <a href={lastPush.data.pushed} target="_blank" rel="noopener noreferrer">
            {agent.branch}
          </a>{" "}
          ·{" "}
          <a href={lastPush.data.compareUrl} target="_blank" rel="noopener noreferrer">
            Open a pull request
          </a>
        </p>
      )}

      {replay.live && running && n > 0 && !pushedSinceChange && !later && (
        <div className="ask-card kind-push">
          <p className="ask-card-text">
            Push {n} {n === 1 ? "change" : "changes"} to GitHub? They go on its own branch <span className="brain-mono">{agent.branch}</span> in {agent.repo} (never main); then you can open a pull request.
          </p>
          <div className="ask-card-actions">
            <button type="button" className="brain-btn" onClick={() => setLater(true)} disabled={pushing}>
              Not now
            </button>
            <button type="button" className="brain-btn is-primary" onClick={doPush} disabled={pushing}>
              {pushing ? "Pushing…" : "Push to GitHub"}
            </button>
          </div>
        </div>
      )}
      {pushError && <p className="inspector-error">{pushError}</p>}
    </div>
  );
}
