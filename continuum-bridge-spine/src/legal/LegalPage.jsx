import { Link, useLocation, useNavigate } from "react-router-dom";
import { copyrightLine, LEGAL_INTRO, LEGAL_SECTIONS } from "./legalText";
import "./Legal.css";

/** The Legal page (/legal): open to everyone, signed in or not. */
export default function LegalPage() {
  const navigate = useNavigate();
  const { key } = useLocation();
  // Close: back to the screen it was opened from, or the start when opened directly
  const close = () => (key !== "default" ? navigate(-1) : navigate("/"));
  return (
    <div className="legal-page">
      <header className="legal-page-head">
        <Link to="/" className="legal-page-brand">
          Continuum Console
        </Link>
        <button type="button" className="legal-page-close" onClick={close} aria-label="Close the legal notice" title="Close">
          <CloseIcon />
        </button>
      </header>
      <main className="legal-page-body">
        <h1>Legal notice</h1>
        <p className="legal-page-intro">{LEGAL_INTRO}</p>
        {LEGAL_SECTIONS.map((s) => (
          <section key={s.title} className="legal-section">
            <h2>{s.title}</h2>
            <p>{s.text}</p>
          </section>
        ))}
        <p className="legal-page-owner">{copyrightLine()}. All rights reserved.</p>
      </main>
    </div>
  );
}

/** A cross (two strokes), drawn in the text colour. */
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
