import { power } from "../content/powerOfContinuum";
import FeatureArt from "./FeatureArt";
import "./PowerOfContinuum.css";

/**
 * The power of continuum: every feature as a card with its picture, the row
 * gliding slowly sideways on its own (it pauses while you point at it or
 * tab into it). With less motion asked for, the cards simply wrap in a grid.
 * onPick(id): a card was chosen (the public page scrolls to its section).
 */
export default function PowerOfContinuum({ onPick, title = power.title, lead = power.lead }) {
  // Twice over, so the row joins up seamlessly as it glides; the copy is hidden from screen readers
  const card = (f, copy) => (
    <li key={`${f.id}${copy ? "-copy" : ""}`} className={`power-card tone-${f.tone}`} aria-hidden={copy || undefined}>
      <button type="button" className="power-card-btn" tabIndex={copy ? -1 : 0} onClick={() => onPick?.(f.id)}>
        <span className="power-art">
          <FeatureArt id={f.id} />
        </span>
        <span className="power-kicker">{f.kicker}</span>
        <span className="power-title">{f.title}</span>
        <span className="power-line">{f.line}</span>
      </button>
    </li>
  );
  return (
    <section className="power" aria-labelledby="power-title">
      <h2 id="power-title" className="power-heading">
        {title}
      </h2>
      {lead && <p className="power-lead">{lead}</p>}
      <div className="power-rail">
        <ul className="power-track">
          {power.features.map((f) => card(f, false))}
          {power.features.map((f) => card(f, true))}
        </ul>
      </div>
    </section>
  );
}
