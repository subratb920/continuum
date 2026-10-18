import React, { useEffect, useState } from "react";
import { startInterval, uploadFolderSnapshot } from "../api";
import { folderAccess, localFoldersAvailable, pickFolder, savedFolder } from "../brain/localFolder";
import { snapshotOf } from "../utils/folderSnapshot";
import { prepareIntervalAlerts } from "../utils/intervalAlerts";
import DurationPicker from "../components/DurationPicker";
import { useAuth } from "../state/authStore";
import { useBrain } from "../brain/brainContext";
import "./IntervalSetup.css";

export default function IntervalSetup({
  activeProject,
  selectedProject,
  onIntervalStarted,
}) {
  const [ticketUrl, setTicketUrl] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState([]);
  const [mode, setMode] = useState("Execution");
  const [duration, setDuration] = useState(30);
  // Who works it: "me" (timed, today's interval) or "brain" (Continuum Brain works the goals; no duration)
  const [who, setWho] = useState("me");
  const { can } = useAuth();
  const brain = useBrain();
  const brainOffered = Boolean(brain) && can("agents_run");
  const byBrain = brainOffered && who === "brain";

  // Where the brain's workers work: your folder on this computer (Chrome/Edge), or GitHub (a phone)
  const onComputer = localFoldersAvailable();
  const hasRepo = Boolean(selectedProject?.githubRepoUrl || selectedProject?.fullName);
  const [workIn, setWorkIn] = useState(onComputer ? "device" : "github");
  const [folder, setFolder] = useState(null);
  const [sending, setSending] = useState("");
  const [startError, setStartError] = useState("");
  const projectId = selectedProject?._id;
  useEffect(() => {
    if (!onComputer || !projectId) return undefined;
    let live = true;
    savedFolder(projectId).then((h) => live && setFolder(h ?? null));
    return () => {
      live = false;
    };
  }, [onComputer, projectId]);
  const inFolder = byBrain && onComputer && workIn === "device";
  // What stops a brain interval from starting: no folder picked, or (a phone) no GitHub repository
  const blockedBy = !byBrain ? "" : inFolder && !folder ? "Pick your project folder for the workers." : !inFolder && !hasRepo ? "This project isn't on GitHub: start it from a computer to work in your folder, or put it on GitHub first." : "";

  async function chooseFolder() {
    setStartError("");
    try {
      const h = await pickFolder(projectId, selectedProject?.name);
      if (h) setFolder(h);
    } catch (err) {
      setStartError(err.message);
    }
  }

  /* --------------------------------------------------
     Execution Gate
  -------------------------------------------------- */
  const isExecutable =
    activeProject &&
    selectedProject &&
    activeProject._id === selectedProject._id;

  /* --------------------------------------------------
     Session Goals
  -------------------------------------------------- */
  function addGoal() {
    if (!goalInput.trim()) return;

    setGoals((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: goalInput.trim(),
        status: "untouched",
      },
    ]);

    setGoalInput("");
  }

  function removeGoal(id) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  /* --------------------------------------------------
     Start Interval
  -------------------------------------------------- */
  async function handleStartInterval() {
    if (!isExecutable || goals.length === 0 || blockedBy || sending) return;
    setStartError("");

    // Your folder: access asked for during the click (the browser forgets it after a restart), then read and sent
    if (inFolder) {
      try {
        if ((await folderAccess(folder, true)) !== "granted") throw new Error(`Continuum needs access to ${folder.name} to send it to the workers.`);
        setSending("Reading your folder…");
        const snap = await snapshotOf(folder);
        setSending(`Sending your folder (${snap.files} files)…`);
        await uploadFolderSnapshot(activeProject._id, snap.blob);
      } catch (err) {
        setStartError(err.message === "UNAUTHORIZED" ? "Your session has ended: sign in again." : err.message);
        setSending("");
        return;
      }
      setSending("");
    }

    // Must run during the click: browsers only allow the notification
    // prompt and audio after a user action (a timed interval's end)
    if (!byBrain) prepareIntervalAlerts();

    const bridge = await startInterval({
      projectId: activeProject._id,
      mode,
      duration,
      kind: byBrain ? "agent" : "human",
      workFrom: inFolder ? "device" : "github",
      ticketUrl,
      sessionGoals: goals.map((g) => ({
        id: g.id,
        text: g.text,
        status: g.status,
      })),
    });

    // The brain is given its goals (if it can't take them now, the agent bridge offers to hand them over again)
    if (byBrain) await brain.startAgentInterval(String(bridge._id)).catch(() => null);

    setGoals([]);
    setGoalInput("");
    onIntervalStarted({
      ...bridge,
      sessionGoals: goals.map(g => ({
        id: g.id,
        text: g.text,
        status: "untouched",
      })),
    });
  }

  /* --------------------------------------------------
     UI
  -------------------------------------------------- */
  return (
    <div
      className={`interval-setup ${!isExecutable ? "interval-locked" : ""
        }`}
    >
      {/* "<project> – Interval Setup": on phones the projects pane isn't on screen */}
      <h2 className="interval-title">
        {selectedProject && (
          <>
            <span className="interval-project" title={selectedProject.name}>
              {selectedProject.name}
            </span>
            <span className="interval-title-sep">
              –
            </span>
          </>
        )}
        Interval Setup
        {!isExecutable && selectedProject && (
          <span className="inactive-tag"> · inactive project</span>
        )}
      </h2>

      <fieldset
        disabled={!isExecutable}
        className={`interval-fieldset${!isExecutable ? " disabled" : ""}`}
      >
        {/* Interval Mode */}
        <section className="interval-section">
          <h3>Interval Mode</h3>
          {["Decision", "Execution", "Continuity", "Alignment"].map((m) => (
            <label key={m} className="radio">
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m}
            </label>
          ))}
        </section>

        {/* Who works this interval: you (timed) or Continuum Brain (it plans, assigns, reviews and ends it) */}
        {brainOffered && (
          <section className="interval-section">
            <h3>Who works this interval?</h3>
            <div className="interval-who" role="radiogroup" aria-label="Who works this interval">
              <label className={`interval-who-option${who === "me" ? " is-on" : ""}`}>
                <input type="radio" name="who" checked={who === "me"} onChange={() => setWho("me")} />
                <span className="interval-who-title">Me</span>
                <span className="interval-who-line">A timed interval: you work the goals and record what happened.</span>
              </label>
              <label className={`interval-who-option${who === "brain" ? " is-on" : ""}`}>
                <input type="radio" name="who" checked={who === "brain"} onChange={() => setWho("brain")} />
                <span className="interval-who-title">✦ Continuum Brain</span>
                <span className="interval-who-line">The brain splits the goals into tasks, gives them to workers, reviews the work, marks each goal and ends the interval itself. No timer.</span>
              </label>
            </div>
          </section>
        )}

        <section className="interval-section">
          <h3>Ticket / Story Link</h3>

          <input
            type="url"
            placeholder="Paste a GitHub issue, Jira ticket, or story link."
            value={ticketUrl}
            onChange={(e) => setTicketUrl(e.target.value)}
            className="interval-input"
          />
        </section>

        {/* Session Goals */}
        <section className="interval-section">
          <h3>Session Goals</h3>

          <div className="goal-input-row">
            <textarea
              className="goal-textarea"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="Describe what you want to achieve in this interval…"
              rows={4}
            />
            <button type="button" className="goal-add" onClick={addGoal}>
              Add
            </button>
          </div>

          {goals.length > 0 && (
            <ol className="session-goals">
              {goals.map((g, index) => (
                <li key={g.id}>
                  <div className="session-goal-item">
                    <span className="goal-text">{g.text}</span>
                    <button
                      className="goal-remove"
                      onClick={() => removeGoal(g.id)}
                      aria-label={`Remove goal ${index + 1}`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Where the brain's workers work: your folder (a computer) or GitHub (a phone) */}
        {byBrain && (
          <section className="interval-section">
            <h3>Works in</h3>
            {onComputer ? (
              <div className="interval-who" role="radiogroup" aria-label="Where the workers work">
                <label className={`interval-who-option${workIn === "device" ? " is-on" : ""}`}>
                  <input type="radio" name="workIn" checked={workIn === "device"} onChange={() => setWorkIn("device")} />
                  <span className="interval-who-title">💻 Your folder</span>
                  <span className="interval-who-line">
                    {folder ? (
                      <>
                        📁 {folder.name} ·{" "}
                        <button type="button" className="interval-link" onClick={chooseFolder}>
                          Change
                        </button>
                      </>
                    ) : (
                      <button type="button" className="interval-link" onClick={chooseFolder}>
                        Pick your project folder
                      </button>
                    )}
                    <br />
                    Workers start from it; the changes you allow come back into it.
                  </span>
                </label>
                <label className={`interval-who-option${workIn === "github" ? " is-on" : ""}${hasRepo ? "" : " is-off"}`}>
                  <input type="radio" name="workIn" checked={workIn === "github"} disabled={!hasRepo} onChange={() => setWorkIn("github")} />
                  <span className="interval-who-title">GitHub</span>
                  <span className="interval-who-line">{hasRepo ? "Workers start from the project's GitHub repository." : "This project isn't on GitHub."}</span>
                </label>
              </div>
            ) : (
              <p className="hint">{hasRepo ? "GitHub: on a phone, workers start from the project's GitHub repository." : "This project isn't on GitHub: start it from a computer to work in your folder."}</p>
            )}
          </section>
        )}

        {/* Interval Duration (a timed interval only: the brain ends its own) */}
        {!byBrain && (
        <section className="interval-section">
          <h3>Interval Duration</h3>
          <DurationPicker
            value={duration}
            onChange={setDuration}
            min={5}
            max={240}
            step={5}
            defaultValue={30}
            disabled={!isExecutable}
          />
        </section>
        )}
      </fieldset>

      {!isExecutable && selectedProject && (
        <p className="hint warning">
          This project is not active. Activate it to start an interval.
        </p>
      )}

      {isExecutable && goals.length === 0 && (
        <p className="hint">
          Add at least one session goal to start an interval.
        </p>
      )}

      {blockedBy && isExecutable && goals.length > 0 && <p className="hint warning">{blockedBy}</p>}
      {startError && <p className="hint warning">{startError}</p>}
      {sending && <p className="hint">{sending}</p>}

      <button
        type="button"
        className="primary"
        onClick={handleStartInterval}
        disabled={!isExecutable || goals.length === 0 || Boolean(blockedBy) || Boolean(sending)}
      >
        {sending ? "Sending your folder…" : byBrain ? "Start the brain on these goals" : "Start Interval"}
      </button>
    </div>
  );
}
