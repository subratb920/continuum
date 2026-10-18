import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import BrandMark from "../components/BrandMark";
import FeatureArt from "../components/FeatureArt";
import PowerOfContinuum from "../components/PowerOfContinuum";
import { power } from "../content/powerOfContinuum";
import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-500.css";
import "../layout/ShellHeader.css";
import "./Landing.css";

/**
 * The public page (/ before sign-in): what Continuum is and does, calmly.
 * A hero over a slow aurora, the power of continuum
 * gliding by, then one section per feature in its own soft colour, each
 * easing in as it scrolls into view. Sign in is always at hand (/signin).
 */
export default function Landing() {
  const page = useRef(null);

  // Sections ease in as they come into view (once each)
  useEffect(() => {
    const root = page.current;
    if (!root || !("IntersectionObserver" in window)) return undefined;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          seen.unobserve(e.target);
        }
      },
      { root, threshold: 0.18 }
    );
    root.querySelectorAll(".reveal").forEach((el) => seen.observe(el));
    return () => seen.disconnect();
  }, []);

  const goTo = (id) => page.current?.querySelector(`#feature-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="landing" ref={page}>
      <header className="landing-bar">
        <Link to="/" className="shell-title" aria-label="Continuum Console">
          <BrandMark size={22} />
          <span className="shell-wordmark">
            <span className="shell-wordmark-name">continuum</span>
            <span className="shell-wordmark-app">Console</span>
          </span>
        </Link>
        <nav className="landing-bar-links" aria-label="Page">
          <button type="button" className="landing-link" onClick={() => goTo(power.features[0].id)}>
            Features
          </button>
          <Link to="/signin" className="landing-btn is-small">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-aurora" aria-hidden="true">
          <span className="aurora-a" />
          <span className="aurora-b" />
          <span className="aurora-c" />
        </div>
        <div className="landing-hero-inner">
          <h1 className="landing-title">AI Agent Orchestrated Development, Data Curation &amp; Model Training IDE</h1>
          <p className="landing-motto">Keep your work moving, calmly.</p>
          <p className="landing-sub">Plan in focused intervals, hand the coding to AI that asks before it acts, prepare your data and ship to your own cloud. Continuum remembers where you left off.</p>
          <div className="landing-ctas">
            <Link to="/signin" className="landing-btn">
              Sign in
            </Link>
            <Link to="/signin?new=1" className="landing-btn is-quiet">
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <div className="landing-power reveal">
        <PowerOfContinuum onPick={goTo} />
      </div>

      {power.features.map((f, i) => (
        <section key={f.id} id={`feature-${f.id}`} className={`landing-feature tone-${f.tone}${i % 2 ? " is-flipped" : ""}`}>
          <div className="landing-feature-inner reveal">
            <div className="landing-feature-text">
              <span className="landing-kicker">{f.kicker}</span>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
              <ul className="landing-points">
                {f.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <div className="landing-feature-art">
              <FeatureArt id={f.id} />
            </div>
          </div>
        </section>
      ))}

      <section className="landing-end reveal">
        <BrandMark size={34} />
        <h2>Ready when you are.</h2>
        <p>Sign in to pick up exactly where you left off.</p>
        <div className="landing-ctas">
          <Link to="/signin" className="landing-btn">
            Sign in
          </Link>
          <Link to="/signin?new=1" className="landing-btn is-quiet">
            Create an account
          </Link>
        </div>
      </section>
    </div>
  );
}
