import { useState } from "react";
import { compact, count, percent } from "./dataDisplay";

/**
 * The profile's two small charts, one series each (so no legend: the heading
 * names it). Marks use the accent token; text stays in text tokens.
 */

/** Label counts as horizontal bars, each with its name and value (also the table view). */
export function LabelBars({ counts, total }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <ul className="data-bars" role="table" aria-label="How many rows each label has">
      {counts.map((c) => (
        <li key={String(c.value)} role="row" className="data-bar-row" title={`${c.value ?? "(no label)"}: ${count(c.count)} rows (${percent(c.count, total)})`}>
          <span role="cell" className="data-bar-name">{c.value ?? <em>no label</em>}</span>
          <span role="cell" className="data-bar-track" aria-hidden="true">
            <span className="data-bar-fill" style={{ width: `${(c.count / max) * 100}%` }} />
          </span>
          <span role="cell" className="data-bar-value">{compact(c.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A histogram of lengths (or any numeric column), with a hover tooltip per bin. */
export function Histogram({ bins, unit = "", label }) {
  const [hover, setHover] = useState(null);
  if (!bins?.length) return null;
  const W = 300;
  const H = 96;
  const pad = { top: 6, bottom: 18 };
  const max = Math.max(1, ...bins.map((b) => b.count));
  const slot = W / bins.length;
  const barW = Math.min(24, slot - 2); // a 2px surface gap between touching bars
  const plotH = H - pad.top - pad.bottom;
  const r = 4;
  const fmt = (v) => compact(Math.round(v));
  const h = hover === null ? null : bins[hover];

  return (
    <figure className="data-hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        <line className="data-hist-axis" x1="0" x2={W} y1={H - pad.bottom + 0.5} y2={H - pad.bottom + 0.5} />
        {bins.map((b, i) => {
          const bh = b.count ? Math.max(2, (b.count / max) * plotH) : 0;
          const x = i * slot + (slot - barW) / 2;
          const y = H - pad.bottom - bh;
          const rr = Math.min(r, bh, barW / 2);
          // rounded at the data end, square at the baseline
          const d = bh
            ? `M${x},${y + bh} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + barW - rr} Q${x + barW},${y} ${x + barW},${y + rr} V${y + bh} Z`
            : "";
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect className="data-hist-hit" x={i * slot} y={pad.top} width={slot} height={plotH} />
              {d && <path className={`data-hist-bar${hover === i ? " is-hover" : ""}`} d={d} />}
            </g>
          );
        })}
        <text className="data-hist-tick" x="0" y={H - 4}>{fmt(bins[0].from)}{unit}</text>
        <text className="data-hist-tick" x={W} y={H - 4} textAnchor="end">{fmt(bins[bins.length - 1].to)}{unit}</text>
      </svg>
      <figcaption className="data-hist-tip" aria-live="polite">
        {h ? `${fmt(h.from)}–${fmt(h.to)}${unit}: ${count(h.count)} rows` : " "}
      </figcaption>
    </figure>
  );
}
