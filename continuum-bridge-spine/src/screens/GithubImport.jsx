import React from "react";
import "./GithubImport.css";
import { useAuth } from "../state/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function GithubImport() {
    const { overrideAuthProvider } = useAuth();

    const handleSkip = () => {
        overrideAuthProvider("local");
    };

    const handleFetchRepos = async () => {
        try {
            const res = await fetch(`${API_BASE}/github/repos`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("continuum_token")}`,
                },
            });

            const data = await res.json();
            console.log(data); // for now
        } catch (err) {
            console.error("Failed to fetch repos", err);
        }
    };

    return (
        <div className="github-import-root">
            <div className="github-import-card">
                <h1>Import from GitHub</h1>

                <p>
                    To import your GitHub repositories, please authenticate with your GitHub account.
                </p>

                <div className="btn-group">
                    <button
                        type="button"
                        onClick={handleFetchRepos}
                        className="github-auth-btn"
                    >
                        Fetch GitHub Repositories
                    </button>

                    <button onClick={handleSkip} className="skip-btn">
                        Skip and use local projects
                    </button>
                </div>
            </div>
        </div>
    );
}