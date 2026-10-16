import { useBrain } from "../../brain/brainContext";
import { clock, useNow } from "./agentDisplay";

const SPEEDS = [1, 4, 16, 64];
// On the track: when workers started, asked you something, or failed
const MARKS = { permission: "asking", question: "asking", error: "failed" };

/**
 * Replay (under the stage): drag back through what the agents did (as far as
 * the events go, up to 24 hours), play it at 1–64×, or jump back to live.
 * While replaying, the whole screen shows that moment; the actions wait for live.
 */
export default function ReplayBar() {
  const brain = useBrain();
  const now = useNow(1000);
  const { replay, seek, playReplay, setReplaySpeed, live } = brain;
  if (!replay.from) return null;

  const to = Math.max(now, replay.from + 1000);
  const at = replay.live ? to : replay.at;
  const pct = (t) => `${((t - replay.from) / (to - replay.from)) * 100}%`;
  const marks = live.events.filter((e) => MARKS[e.kind] || (e.kind === "state" && e.data?.state === "starting"));

  return (
    <div className={`replay-bar${replay.live ? "" : " replaying"}`}>
      <button
        type="button"
        className="replay-play"
        onClick={() => playReplay(!replay.playing)}
        aria-label={replay.playing ? "Pause the replay" : "Play from here"}
        title={replay.live ? "Replay from the start" : replay.playing ? "Pause" : "Play"}
      >
        {replay.playing ? "❚❚" : "▶"}
      </button>

      <div className="replay-track">
        <ul className="replay-marks" aria-hidden="true">
          {marks.map((e) => (
            <li key={e._id} className={MARKS[e.kind] ?? "started"} style={{ left: pct(Date.parse(e.at)) }} />
          ))}
        </ul>
        <input
          type="range"
          min={replay.from}
          max={to}
          step={250}
          value={at}
          aria-label="Replay time"
          aria-valuetext={replay.live ? "Live" : clock(at)}
          onChange={(e) => {
            const t = Number(e.target.value);
            seek(t >= to - 1000 ? null : t); // the right end is live
          }}
        />
      </div>

      <span className="replay-time">{replay.live ? "Live" : clock(at)}</span>

      <select className="replay-speed" value={replay.speed} onChange={(e) => setReplaySpeed(Number(e.target.value))} aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <button type="button" className="brain-btn replay-live" onClick={() => seek(null)} disabled={replay.live}>
        <span className="replay-live-dot" aria-hidden="true" /> Live
      </button>
    </div>
  );
}
