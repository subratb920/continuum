import React from "react";
import "./GithubImport.css";
import { useAuth } from "../state/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function GithubImport() {
  const { overrideAuthProvider } = useAuth();

  const handleSkip = () => {
    overrideAuthProvider("local");
  };

  return (
    <div className="github-import-root">
      <div className="github-import-card">
        <h1>Import from GitHub</h1>

        <p>
          To import your GitHub repositories, please authenticate with your GitHub account.
        </p>

        <div className="btn-group">
          <a
            href={`${API_BASE}/auth/github`}
            className="github-auth-btn"
          >
            Authenticate with GitHub
          </a>

          <button onClick={handleSkip} className="skip-btn">
            Skip and use local projects
          </button>
        </div>
      </div>
    </div>
  );
}