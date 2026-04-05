import React, { useState } from "react";
import "./GithubImport.css";
import { useAuth } from "../state/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export default function GithubImport() {
    const { overrideAuthProvider } = useAuth();
    const [loading, setLoading] = useState(false);
    const [repos, setRepos] = useState([]);
    const [selected, setSelected] = useState([]);
    const [search, setSearch] = useState("");

    const filteredRepos = repos.filter((repo) =>
        repo.name.toLowerCase().includes(search.toLowerCase())
    );

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

    const toggleRepo = (id) => {
        setSelected((prev) =>
            prev.includes(id)
                ? prev.filter((n) => n !== id)
                : [...prev, id]
        );
    };

    const selectedRepos = repos.filter((r) =>
        selected.includes(r.id)
    );

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
                        <>
                            <input
                                type="text"
                                placeholder="Search repositories..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="repo-search"
                            />

                            <div className="repo-actions">
                                <button onClick={() => setSelected(repos.map(r => r.id))}>
                                    Select All
                                </button>

                                <button onClick={() => setSelected([])}>
                                    Clear
                                </button>
                            </div>

                            <div className="repo-list">
                                {filteredRepos.map((repo) => (
                                    <div
                                        key={repo.id}
                                        className={`repo-item ${selected.includes(repo.id) ? "selected" : ""
                                            }`}
                                        onClick={() => toggleRepo(repo.id)}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(repo.id)}
                                            readOnly
                                        />

                                        <span className="repo-name">{repo.name}</span>

                                        <span
                                            className={`repo-badge ${repo.private ? "private" : "public"
                                                }`}
                                        >
                                            {repo.private ? "Private" : "Public"}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={handleImport}
                                disabled={selected.length === 0}
                                className="github-auth-btn"
                            >
                                {selected.length === 0
                                    ? "Select repositories to import"
                                    : `Import (${selected.length})`}
                            </button>
                        </>
                    )}
                    <button onClick={handleSkip} className="skip-btn">
                        Skip and use local projects
                    </button>
                </div>
            </div>
        </div>
    );
}