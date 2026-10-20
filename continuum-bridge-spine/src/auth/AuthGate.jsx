import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../state/authStore";
import { FaGithub, FaGoogle } from "react-icons/fa";
import "./AuthGate.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function AuthGate() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // login | signup ("Create an account" on the public page opens it as signup: /signin?new=1)
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).has("new") ? "signup" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      navigate("/workflows", { replace: true }); // sign-in lands on Workflows (App sends roles without Agents home)
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

        <div className="auth-divider">
          <span>or</span>
        </div>

        <div className="auth-social">
          <button
            type="button"
            className="social-btn github"
            onClick={() => {
              window.location.href = `${API_BASE}/auth/github`;
            }}
          >
            <FaGithub className="icon" />
            Continue with GitHub
          </button>

          <button
            type="button"
            className="social-btn google"
            onClick={() => {
              console.log("GITHUB CLICKED");
              window.location.href = `${API_BASE}/auth/google`;
            }}
          >
            <FaGoogle className="icon" />
            Continue with Google
          </button>
        </div>

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
