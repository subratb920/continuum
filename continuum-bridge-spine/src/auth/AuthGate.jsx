import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../state/authStore";
import { FaGithub } from "react-icons/fa";
import "./AuthGate.css";

/** Google's "G", in its four colours (Google's brand rules for Sign in with Google). */
function GoogleG() {
  return (
    <svg className="google-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path className="g-red" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path className="g-blue" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path className="g-yellow" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path className="g-green" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function AuthGate() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // login | signup ("Create an account" on the public page opens it as signup: /signin?new=1)
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).has("new") ? "signup" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Back from Google or GitHub with a reason it didn't work (/signin?error=…)
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get("error") ?? "");
  const [loading, setLoading] = useState(false);
  // Which ways to sign in this Continuum offers (a button only for those set up)
  const [providers, setProviders] = useState({ github: true, google: false });
  const [leaving, setLeaving] = useState(null); // "google" | "github": on the way to it

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/auth/providers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => live && p && setProviders(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const signInWith = (provider) => {
    setLeaving(provider);
    window.location.href = `${API_BASE}/auth/${provider}`;
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let res;
      try {
        res = await fetch(`${API_BASE}/auth/${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });
      } catch {
        throw new Error("Can't reach the server. Check your connection.");
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong. Please try again.");
      }

      login(data.token);
      navigate("/chat", { replace: true }); // sign-in lands on Chat (App sends roles without Agents home)
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <Link to="/" className="auth-about">
          ← About continuum
        </Link>
        <h1 className="auth-title">Continuum</h1>
        <p className="auth-subtitle">
          Single focus. Continuous execution.
        </p>

        {/* Google first: one click, no password */}
        {providers.google && (
          <>
            <button type="button" className="google-btn" onClick={() => signInWith("google")} disabled={!!leaving}>
              <span className="google-btn-mark">
                <GoogleG />
              </span>
              <span className="google-btn-text">{leaving === "google" ? "Opening Google…" : "Continue with Google"}</span>
            </button>
            <div className="auth-divider">
              <span>or with your email</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        {providers.github && (
          <>
            <div className="auth-divider">
              <span>or</span>
            </div>

            <div className="auth-social">
              <button type="button" className="social-btn github" onClick={() => signInWith("github")} disabled={!!leaving}>
                <FaGithub className="icon" />
                {leaving === "github" ? "Opening GitHub…" : "Continue with GitHub"}
              </button>
            </div>
          </>
        )}

        <div className="auth-switch">
          {mode === "login" ? (
            <span>
              New here?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
              >
                Create account
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
