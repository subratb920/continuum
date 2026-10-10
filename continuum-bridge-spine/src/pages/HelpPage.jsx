import { Link } from "react-router-dom";
import {
  overview,
  gettingStarted,
  model,
  capabilities,
  modes,
  glossary,
  roadmap,
} from "../content/continuumGuide";

import "./HelpPage.css";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting Started" },
  { id: "model", label: "The Model" },
  { id: "capabilities", label: "Capabilities" },
  { id: "modes", label: "The Four Modes" },
  { id: "glossary", label: "Glossary" },
  { id: "roadmap", label: "Roadmap" },
];

/**
 * HelpPage (/help)
 * ----------------
 * How Continuum works. All text comes from content/continuumGuide.js.
 * Current capabilities and the future roadmap are kept visibly separate.
 */
export default function HelpPage() {
  return (
    <div className="help-page">
      <Link to="/console" className="help-back">
        ← Back to Continuum
      </Link>

      <header className="help-hero">
        <h1>How Continuum works</h1>
        <p className="help-tagline">{overview.tagline}</p>
      </header>

      <nav className="help-nav" aria-label="Help sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      {/* Overview */}
      <section id="overview" className="help-section">
        <h2>Overview</h2>
        <p className="help-lead">{overview.summary}</p>

        {overview.sections.map((sec) => (
          <div key={sec.heading}>
            <h3>{sec.heading}</h3>
            {sec.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        ))}

        <blockquote className="help-quote">{overview.principle}</blockquote>
        <p>
          <strong>The goal: </strong>
          {overview.goal}
        </p>
      </section>

      {/* Getting started */}
      <section id="getting-started" className="help-section">
        <h2>{gettingStarted.title}</h2>
        <ol className="help-steps">
          {gettingStarted.steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>

        <div className="help-tip">
          <h3>{gettingStarted.goalTip.heading}</h3>
          <p>{gettingStarted.goalTip.text}</p>
          <ul>
            {gettingStarted.goalTip.examples.map((ex) => (
              <li key={ex.label}>
                <span className="help-tip-label">{ex.label}:</span> “{ex.text}”
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Model */}
      <section id="model" className="help-section">
        <h2>{model.title}</h2>
        <ol className="help-principles">
          {model.principles.map((p) => (
            <li key={p.title}>
              <strong>{p.title}</strong>
              <span>{p.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Current capabilities */}
      <section id="capabilities" className="help-section">
        <h2>{capabilities.title}</h2>
        <div className="help-cards">
          {capabilities.items.map((item) => (
            <div key={item.title} className="help-card">
              <div className="help-card-head">
                <strong>{item.title}</strong>
                <span className="help-badge help-badge-available">{item.status}</span>
              </div>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modes */}
      <section id="modes" className="help-section">
        <h2>{modes.title}</h2>
        <p>{modes.intro}</p>
        <table className="help-table">
          <thead>
            <tr>
              <th>Mode</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {modes.items.map((m) => (
              <tr key={m.name}>
                <td>
                  <strong>{m.name}</strong>
                </td>
                <td>{m.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-note">{modes.note}</p>
      </section>

      {/* Glossary */}
      <section id="glossary" className="help-section">
        <h2>{glossary.title}</h2>
        <dl className="help-glossary">
          {glossary.terms.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.definition}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Roadmap — future, visibly separate */}
      <section id="roadmap" className="help-section help-roadmap">
        <div className="help-roadmap-head">
          <h2>{roadmap.title}</h2>
          <span className="help-badge help-badge-future">{roadmap.label}</span>
        </div>
        <p>{roadmap.intro}</p>

        {roadmap.directions.map((d) => (
          <div key={d.heading}>
            <h3>{d.heading}</h3>
            <p>{d.text}</p>
          </div>
        ))}

        {roadmap.horizons.map((h) => (
          <details key={h.name} className="help-horizon">
            <summary>
              <strong>{h.name}</strong>
              <span className="help-horizon-tag">{h.tag}</span>
            </summary>
            <p>{h.summary}</p>
            <ul>
              {h.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </div>
  );
}
