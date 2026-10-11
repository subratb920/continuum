import { useEffect, useRef, useState } from "react";
import "./SsoAuthorize.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const TOKEN_KEY = "continuum_token";

/**
 * /sso/authorize — signs the user in to Continuum Deploy (Phase 1 spec, Section 6).
 * The user is already signed in to Continuum here (the sign-in screen is shown
 * first if not). Continuum issues a single-use code and returns the verified
 * address to continue to; nothing is redirected unless continuum-api accepted it.
 * No consent screen: both apps belong to the same owner.
 */
export default function SsoAuthorize() {
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice in development
    started.current = true;

    const q = new URLSearchParams(window.location.search);
    const body = {
      client_id: q.get("client_id"),
      redirect_uri: q.get("redirect_uri"),
      state: q.get("state"),
      code_challenge: q.get("code_challenge"),
      code_challenge_method: q.get("code_challenge_method"),
    };

    // Called directly (not through api.js) so the single-use code is never logged
    fetch(`${API_BASE}/oauth/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`,
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.redirectTo) {
          window.location.replace(data.redirectTo);
        } else {
          setError(data.error_description || data.error || "Continuum Deploy could not be opened.");
        }
      })
      .catch(() => setError("Continuum is not reachable. Please try again."));
  }, []);

  return (
    <div className="sso-page">
      <div className="sso-card" role="status" aria-live="polite">
        {error ? (
          <>
            <h1>Couldn't continue to Continuum Deploy</h1>
            <p className="sso-error">{error}</p>
            <a href="/">Back to Continuum</a>
          </>
        ) : (
          <>
            <h1>Continuing to Continuum Deploy…</h1>
            <p>Signing you in with your Continuum account.</p>
          </>
        )}
      </div>
    </div>
  );
}
