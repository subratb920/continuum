import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBridges, patchBridge } from "../api";
import { useBrain, workersOnGoal } from "../brain/brainContext";
import { ACTIVE_STATES } from "../brain/brainTypes";
import { agentName } from "../screens/brain/agentDisplay";
import { brainStatus } from "../screens/brain/brainStatus";
import { normalizeBridge } from "../utils/normalizeBridge";
import { formatClock } from "../utils/time";

import "../screens/brain/brain.css"; // the brain's state pill, as in Chat
import "./BridgeDraftModal.css";
import "./AgentBridge.css";

/**
 * AgentBridge
 * -----------
 * The running interval's window when Continuum Brain works it (an agent
 * interval; the human one is BridgeDraftModal). No countdown: it's connected
 * to the brain. Each goal shows the tasks the brain split it into (or the
 * goal itself as one task), each with its worker and state, then the brain's
 * verdict once it has reviewed the work. The brain ends the interval and
 * saves the bridge itself; Stop ends it now, saved as it stands.
 * - The bridge is the brain's to change (on the server): this window reads
 *   it again whenever the brain uses one of its bridge tools or a worker
 *   changes state, and every 15 seconds.
 * - onEnded(): the interval ended (the brain finished it, or you stopped it).
 * - docked (Agents, Chat): a corner panel that folds down; minimized: a pill.
 */

const BRIDGE_TOOLS = /plan_goal|update_task|report_goal|finish_interval|spawn_agent/;
const minimizedKey = (id) => `continuum.draftMinimized.${id}`;
const readMinimized = (id) => {
  try {
    return localStorage.getItem(minimizedKey(id)) === "1";
  } catch {
    return false;
  }
};

const TASK_MARK = { done: "✓", working: "●", planned: "○", failed: "✕" };
const TASK_WORD = { done: "done", working: "working", planned: "waiting", failed: "failed" };

/** A live worker's state in the task's words (the bridge may lag a moment behind the brain). */
function liveTaskState(task, agent) {
  if (task.state === "done" || task.state === "failed") return task.state;
  if (!agent) return task.state;
  if (agent.state === "failed") return "failed";
  if (ACTIVE_STATES.includes(agent.state)) return "working";
  return task.state;
}

export default function AgentBridge({ bridge, onEnded, docked = false }) {
  const brain = useBrain();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(bridge);
  const [folded, setFolded] = useState(false);
  const [minimized, setMinimizedState] = useState(() => readMinimized(bridge._id));
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const setMinimized = (v) => {
    setMinimizedState(v);
    try {
      localStorage.setItem(minimizedKey(bridge._id), v ? "1" : "0");
    } catch {
      // the choice just isn't remembered
    }
  };

  // The bridge as the server has it now (the brain writes it); ended: tell App
  const refresh = useCallback(async () => {
    try {
      const list = await fetchBridges(bridge.projectId);
      const raw = list.find((b) => String(b._id) === bridge._id);
      if (!raw) return;
      const fresh = normalizeBridge(raw);
      setCurrent(fresh);
      if (fresh.status !== "draft") onEnded(fresh);
    } catch {
      // the next refresh tries again
    }
  }, [bridge._id, bridge.projectId, onEnded]);

  // Again when the brain uses a bridge tool or any worker moves on; and every 15 s
  const workers = brain?.live.workers ?? [];
  const coreEvents = brain ? brain.events.filter((e) => brain.coreIds.has(e.agentId) && e.kind === "tool" && BRIDGE_TOOLS.test(`${e.data?.tool ?? ""} ${e.text}`)) : [];
  const toolKey = coreEvents.at(-1)?._id ?? "";
  const onThisBridge = workers.filter((w) => w.goal?.bridgeId === bridge._id);
  const workerKey = onThisBridge.map((w) => `${w._id}:${w.state}`).join(",");
  useEffect(() => {
    // A moment later, so a burst of the brain's changes is read once
    const t = setTimeout(refresh, 400);
    return () => clearTimeout(t);
  }, [refresh, toolKey, workerKey]);
  useEffect(() => {
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedAt = Date.parse(current.interval?.startedAt ?? current.createdAt);
  const elapsed = formatClock(Math.max(0, now - startedAt));
  const status = brainStatus(brain?.core, brain?.connected);
  const goals = current.sessionGoals;
  const settled = goals.filter((g) => g.verification).length;

  /** A goal's tasks: the brain's plan, or the goal itself worked by its workers (no split). */
  function tasksOf(g) {
    if (g.tasks?.length) return g.tasks.map((t) => ({ ...t, agent: t.agentId ? workers.find((w) => w._id === t.agentId) ?? null : null }));
    const onIt = workersOnGoal(workers, bridge._id, g.id);
    if (!onIt.length) return [];
    return onIt.map((w) => ({ id: w._id, text: g.text, agentId: w._id, state: w.state === "failed" ? "failed" : "working", note: null, agent: w }));
  }

  const [handing, setHanding] = useState(false);
  async function handOver() {
    setHanding(true);
    setError("");
    try {
      await brain.startAgentInterval(bridge._id);
    } catch (err) {
      setError(err?.message || "The brain couldn't take the goals now. Try again in a moment.");
    }
    setHanding(false);
  }

  async function stopInterval() {
    setStopping(true);
    setError("");
    try {
      // Its workers stop first; the bridge is saved as it stands, with who worked on what
      const mine = onThisBridge.filter((w) => ACTIVE_STATES.includes(w.state) && w.state !== "stopping");
      await Promise.allSettled(mine.map((w) => brain.stop(w._id)));
      const agentNames = Object.fromEntries(workers.map((w) => [w._id, agentName(w, workers)]));
      await patchBridge(bridge._id, { status: "finalized", ended: true, agentNames });
      await refresh();
    } catch (err) {
      setError(err?.message || "The interval couldn't be stopped. Try again.");
      setStopping(false);
    }
  }

  if (minimized) {
    return (
      <div className="bridge-draft-pill">
        <button type="button" className="draft-pill-open" onClick={() => setMinimized(false)} title="Open the agent interval">
          <span className="draft-pill-dot is-running" aria-hidden="true" />
          <span className="draft-pill-clock">✦ {elapsed}</span>
          <span className="draft-pill-meta">
            Agent bridge · {settled} of {goals.length} {goals.length === 1 ? "goal" : "goals"} settled
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={docked ? "bridge-draft-dock" : "modal-backdrop"}>
      <div className={`modal-window bridge-draft agent-bridge${docked ? " docked" : ""}${docked && folded ? " folded" : ""}`}>
        <header className="modal-header">
          <h2>
            <span className="bridge-kind is-agent" title="The brain works this interval's goals">
              ✦ Agent bridge
            </span>
            {current.name}
          </h2>
          {docked && (
            <button type="button" className="draft-fold-btn" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} title={folded ? "Show the goals" : "Fold down"}>
              {folded ? "▴" : "▾"}
            </button>
          )}
          <button type="button" className="draft-fold-btn" onClick={() => setMinimized(true)} title="Minimize" aria-label="Minimize the interval">
            –
          </button>
        </header>

        <section className="modal-body">
          {/* Connected to the brain: its state and how long it has been at it (no countdown) */}
          <div className="agent-bridge-status">
            <span className={`brain-chat-pill is-${status.tone}${status.pulse ? " is-pulsing" : ""}${status.stop ? " is-stopped" : ""}`}>
              <span className="brain-chat-dot" aria-hidden="true" />
              <span className="brain-chat-what">Brain</span>
              {status.label}
            </span>
            <span className="agent-bridge-clock" title="Since the interval started">
              {elapsed}
            </span>
            <span className="agent-bridge-where" title="Where its workers work">
              {current.interval?.workFrom === "device" ? "💻 your folder" : "GitHub"}
            </span>
            <span className="agent-bridge-settled">
              {settled} of {goals.length} settled
            </span>
          </div>

          <ul className="agent-goals">
            {goals.map((g, i) => {
              const tasks = tasksOf(g);
              const done = tasks.filter((t) => liveTaskState(t, t.agent) === "done").length;
              const v = g.verification;
              return (
                <li key={g.id} className={`agent-goal${v ? ` is-${v.verdict}` : ""}`}>
                  <div className="agent-goal-head">
                    <span className="agent-goal-n">{i + 1}</span>
                    <span className="agent-goal-text">{g.text}</span>
                    {v ? (
                      <span className={`agent-verdict is-${v.verdict}`}>{v.verdict === "completed" ? "✓ verified" : "incomplete"}</span>
                    ) : tasks.length ? (
                      <span className="agent-goal-count">
                        {done}/{tasks.length}
                      </span>
                    ) : (
                      <span className="agent-goal-count is-waiting">waiting</span>
                    )}
                  </div>
                  {tasks.length > 0 && (
                    <ul className="agent-tasks">
                      {tasks.map((t) => {
                        const st = liveTaskState(t, t.agent);
                        return (
                          <li key={t.id} className={`agent-task is-${st}`} title={t.note ?? undefined}>
                            <span className="agent-task-mark" aria-hidden="true">
                              {TASK_MARK[st]}
                            </span>
                            <span className="agent-task-text">{t.text}</span>
                            {t.agentId ? (
                              <button type="button" className="agent-task-worker" onClick={() => navigate("/brain")} title="See this worker on the Agents screen">
                                {t.agent ? agentName(t.agent, workers) : `worker ${t.agentId.slice(-4)}`} · {TASK_WORD[st]}
                              </button>
                            ) : (
                              <span className="agent-task-worker is-none">{TASK_WORD[st]}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {v?.note && <p className="agent-verdict-note">{v.note}</p>}
                </li>
              );
            })}
          </ul>

          {/* Nothing under way and the brain isn't working: it may not have taken the goals (it was starting, or stopped) */}
          {!settled && !onThisBridge.length && !goals.some((g) => g.tasks?.length) && !["working", "starting", "queued"].includes(brain?.core?.state) && (
            <div className="agent-bridge-handover">
              <span>The brain hasn't picked these goals up yet.</span>
              <button type="button" className="agent-bridge-btn" disabled={handing} onClick={handOver}>
                {handing ? "Handing over…" : "Give the goals to the brain"}
              </button>
            </div>
          )}

          {error && <p className="draft-error">{error}</p>}
        </section>

        <footer className="modal-footer draft-footer agent-bridge-foot">
          {confirmStop ? (
            <>
              <span className="agent-bridge-confirm">Stop the brain's work now? Its workers stop; the bridge is saved as it stands.</span>
              <button type="button" className="draft-btn-primary" onClick={stopInterval} disabled={stopping}>
                {stopping ? "Stopping…" : "Stop and save"}
              </button>
              <button type="button" className="agent-bridge-btn" onClick={() => setConfirmStop(false)} disabled={stopping}>
                Keep going
              </button>
            </>
          ) : (
            <>
              <button type="button" className="agent-bridge-btn" onClick={() => navigate("/chat")}>
                Open Chat
              </button>
              <button type="button" className="agent-bridge-btn is-stop" onClick={() => setConfirmStop(true)}>
                ■ Stop
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
