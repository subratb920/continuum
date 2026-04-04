import React from "react";
import "./GithubImport.css";
import { useAuth } from "../state/authStore"; // 🔥 IMPORTANT

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function GithubImport() {
    const { overrideAuthProvider } = useAuth(); // 🔥 get from context

    const handleSkip = () => {
        overrideAuthProvider("local"); // 🔥 switch flow
    };

    return (
        <div className="github-import-root">
            <div>
                <h1>Import from GitHub</h1>

                <p>
                    To import your GitHub repositories, please authenticate with your GitHub account.
                </p>

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
    );
}