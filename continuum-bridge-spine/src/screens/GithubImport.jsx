import React, { useState } from "react";
import "./GithubImport.css";
import { useAuth } from "../state/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function GithubImport() {
    const { overrideAuthProvider } = useAuth();
    const [loading, setLoading] = useState(false);
    const [repos, setRepos] = useState([]);
    const [selected, setSelected] = useState([]);

    const handleSkip = () => {
        overrideAuthProvider("local");
    };

    const handleFetchRepos = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/github/repos`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("continuum_token")}`,
                },
            });

            const data = await res.json();
            console.log(data);
            setRepos(data);
        } catch (err) {
            console.error("Failed to fetch repos", err);
        }
    };

    const handleImport = async () => {
        try {
            const selectedRepos = repos.filter((r) =>
                selected.includes(r.name)
            );

            await fetch(`${API_BASE}/github/import`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("continuum_token")}`,
                },
                body: JSON.stringify({ repos: selectedRepos }),
            });

            overrideAuthProvider("local");

        } catch (err) {
            console.error("Import failed", err);
        }
    };

    const toggleRepo = (name) => {
        setSelected((prev) =>
            prev.includes(name)
                ? prev.filter((n) => n !== name)
                : [...prev, name]
        );
    };

    return (
        <div className="github-import-root">
            <div className="github-import-card">
                <h1>Import from GitHub</h1>

                <p>
                    To import your GitHub repositories, please authenticate with your GitHub account.
                </p>

                <div className="btn-group">
                    {repos.length === 0 && (
                        <button
                            type="button"
                            onClick={handleFetchRepos}
                            className="github-auth-btn"
                        >
                            {loading ? "Loading..." : "Fetch GitHub Repositories"}
                        </button>
                    )}

                    {repos.length > 0 && (
                        <div className="repo-list">
                            {repos.map((repo) => (
                                <div
                                    key={repo.id}
                                    className={`repo-item ${selected.includes(repo.name) ? "selected" : ""
                                        }`}
                                    onClick={() => toggleRepo(repo.name)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(repo.name)}
                                        readOnly
                                    />
                                    <span>{repo.name}</span>
                                </div>
                            ))}
                    <button
                        onClick={handleImport}
                        className="github-auth-btn"
                    >
                        Import Selected Repositories
                    </button>
                        </div>

                    )}
                    <button onClick={handleSkip} className="skip-btn">
                        Skip and use local projects
                    </button>
                </div>
            </div>
        </div>
    );
}