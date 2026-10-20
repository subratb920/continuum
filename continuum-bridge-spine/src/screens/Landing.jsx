import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SignInBox from "../auth/SignInBox";
import { useAuth } from "../state/authStore";
import BrandMark from "../components/BrandMark";
import FeatureArt from "../components/FeatureArt";
import PowerOfContinuum from "../components/PowerOfContinuum";
import { power } from "../content/powerOfContinuum";
import "@fontsource/outfit/latin-400.css";
import "@fontsource/outfit/latin-500.css";
import "../layout/ShellHeader.css";
import "./Landing.css";

/**
 * The public page, and where you sign in (/, /signin, or any link into the
 * app while signed out): what Continuum is and does, calmly, with the sign-in
 * box in the hero. A hero over a slow aurora, the power of continuum gliding
 * by, then one section per feature in its own soft colour, each easing in as
 * it scrolls into view. Signed in (/about): the box gives way to "Open Continuum".
 */
export default function Landing() {
  const page = useRef(null);
  const { status } = useAuth();
  const signedOut = status === "unauthenticated";
  // The box: sign in, or create an account ("Create an account" links here as /signin?new=1)
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).has("new") ? "signup" : "login"));

  /** Up to the box, in that mode, ready to type. */
  const toBox = (m) => {
    setMode(m);
    const box = page.current?.querySelector("#signin");
    box?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => box?.querySelector("input[type=email]")?.focus({ preventScroll: true }), 450);
  };

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
          {signedOut ? (
            <button type="button" className="landing-btn is-small" onClick={() => toBox("login")}>
              Sign in
            </button>
          ) : (
            <Link to="/chat" className="landing-btn is-small">
              Open Continuum
            </Link>
          )}
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-aurora" aria-hidden="true">
          <span className="aurora-a" />
          <span className="aurora-b" />
          <span className="aurora-c" />
        </div>
        <div className={`landing-hero-inner${signedOut ? " has-signin" : ""}`}>
          <div className="landing-hero-text">
            <h1 className="landing-title">AI Agent Orchestrated Development, Data Curation &amp; Model Training IDE</h1>
            <hr className="landing-divider" />
            <p className="landing-sub">Plan in focused intervals, hand the coding to AI that asks before it acts, prepare your data and ship to your own cloud. Continuum remembers where you left off.</p>
            {status === "authenticated" && (
              <div className="landing-ctas">
                <Link to="/chat" className="landing-btn">
                  Open Continuum
                </Link>
              </div>
            )}
          </div>
          {signedOut && (
            <div className="landing-signin">
              <SignInBox mode={mode} onMode={setMode} />
            </div>
          )}
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
          {signedOut ? (
            <>
              <button type="button" className="landing-btn" onClick={() => toBox("login")}>
                Sign in
              </button>
              <button type="button" className="landing-btn is-quiet" onClick={() => toBox("signup")}>
                Create an account
              </button>
            </>
          ) : (
            <Link to="/chat" className="landing-btn">
              Open Continuum
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
