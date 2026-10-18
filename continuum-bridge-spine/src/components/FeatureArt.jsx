/**
 * A small, slow picture for each feature of Continuum (content/
 * powerOfContinuum.js): calm loops in the feature's own colour (--tone).
 * Still when the system asks for less motion (FeatureArt.css).
 */
import "./FeatureArt.css";

export default function FeatureArt({ id }) {
  const Art = ART[id];
  return Art ? <Art /> : null;
}

/** Intervals: a 30-minute dial filling, three goals ticking off one by one */
function Intervals() {
  return (
    <svg className="art art-intervals" viewBox="0 0 200 120" aria-hidden="true">
      <circle className="art-faint" cx="56" cy="60" r="34" />
      <circle className="art-dial" cx="56" cy="60" r="34" pathLength="100" />
      <text className="art-dial-text" x="56" y="64">30:00</text>
      {[0, 1, 2].map((i) => (
        <g key={i} className="art-goal" style={{ "--i": i }} transform={`translate(112 ${34 + i * 24})`}>
          <rect className="art-faint-fill" width="72" height="14" rx="7" />
          <circle className="art-check" cx="7" cy="7" r="4.5" />
        </g>
      ))}
    </svg>
  );
}

/** The Bridge Spine: intervals strung along a line, lighting one after another */
function Spine() {
  const xs = [24, 62, 100, 138, 176];
  return (
    <svg className="art art-spine" viewBox="0 0 200 120" aria-hidden="true">
      <path className="art-faint" d="M24 60 L176 60" />
      <path className="art-spine-line" d="M24 60 L176 60" pathLength="100" />
      {xs.map((x, i) => (
        <g key={x} className="art-bridge" style={{ "--i": i }}>
          <circle cx={x} cy="60" r="9" />
          <path d={`M${x - 8} ${i % 2 ? 84 : 36} Q ${x} ${i % 2 ? 76 : 44} ${x + 8} ${i % 2 ? 84 : 36}`} />
        </g>
      ))}
    </svg>
  );
}

/** Agents: the brain in the middle, workers on a slow orbit around it */
function Agents() {
  return (
    <svg className="art art-agents" viewBox="0 0 200 120" aria-hidden="true">
      <circle className="art-faint" cx="100" cy="60" r="42" />
      <circle className="art-core-glow" cx="100" cy="60" r="20" />
      <circle className="art-core" cx="100" cy="60" r="13" />
      <g className="art-orbit">
        {[0, 120, 240].map((a) => (
          <circle key={a} className="art-worker" cx={100 + 42 * Math.cos((a * Math.PI) / 180)} cy={60 + 42 * Math.sin((a * Math.PI) / 180)} r="7" />
        ))}
      </g>
    </svg>
  );
}

/** Data: rows drifting in, a few falling away, the rest settling in three lanes */
function Data() {
  return (
    <svg className="art art-data" viewBox="0 0 200 120" aria-hidden="true">
      {[36, 60, 84].map((y) => (
        <path key={y} className="art-faint" d={`M120 ${y} L188 ${y}`} />
      ))}
      <path className="art-faint" d="M12 60 L104 60" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} className={`art-row${i === 2 ? " is-out" : ""}`} style={{ "--i": i, "--lane": [-24, 0, 24][i % 3] + "px" }} x="8" y="56" width="12" height="8" rx="2" />
      ))}
    </svg>
  );
}

/** Workspaces: an editor window, lines writing themselves, a blinking cursor */
function Workspaces() {
  return (
    <svg className="art art-workspaces" viewBox="0 0 200 120" aria-hidden="true">
      <rect className="art-window" x="30" y="14" width="140" height="92" rx="10" />
      <path className="art-faint" d="M30 30 L170 30" />
      {[0, 1, 2].map((i) => (
        <circle key={i} className="art-faint-fill" cx={42 + i * 9} cy="22" r="2.6" />
      ))}
      {[52, 92, 70, 104].map((w, i) => (
        <rect key={i} className="art-code" style={{ "--i": i, "--w": `${w}px` }} x={44 + (i === 2 ? 12 : 0)} y={42 + i * 14} width={w} height="6" rx="3" />
      ))}
      <rect className="art-cursor" x="44" y="98" width="2" height="8" />
    </svg>
  );
}

/** Deploy: layers rising into a cloud, one after another */
function Deploy() {
  return (
    <svg className="art art-deploy" viewBox="0 0 200 120" aria-hidden="true">
      <path className="art-cloud" d="M64 50 a22 22 0 0 1 40 -14 a18 18 0 0 1 32 10 a16 16 0 0 1 -4 32 h-64 a16 16 0 0 1 -4 -28 z" />
      {[0, 1, 2].map((i) => (
        <rect key={i} className="art-layer" style={{ "--i": i }} x="82" y="94" width="36" height="8" rx="4" />
      ))}
    </svg>
  );
}

const ART = { intervals: Intervals, spine: Spine, agents: Agents, data: Data, workspaces: Workspaces, deploy: Deploy };
