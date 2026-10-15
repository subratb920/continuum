import React, { useState } from "react";
import "./GithubImport.css";
import DeviceFolderOption from "../components/DeviceFolderOption";
import { getPreferences } from "../utils/preferences";
import { createProjectFolder, filesOfTarball, pickParentFolder, writeFiles } from "../utils/deviceFolder";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

// onImported(): refreshes the project list in the app (no page reload)
// onDone():     leaves the import page (Skip, or after a successful Import)
export default function GithubImport({ onImported, onDone }) {
    const [loading, setLoading] = useState(false);
    const [repos, setRepos] = useState([]);
    const [selected, setSelected] = useState([]);
    const [search, setSearch] = useState("");
    // Off unless ticked: a folder per repository on this device, with its files
    const [makeFolders, setMakeFolders] = useState(() => getPreferences().folderOptionDefault);
    const [progress, setProgress] = useState("");
    const [problem, setProblem] = useState("");

    const filteredRepos = repos.filter((repo) =>
        repo.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleSkip = () => {
        onDone?.();
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

            // Only accept a list; an error response is an object
            if (res.ok && Array.isArray(data)) {
                setRepos(data);
            } else {
                console.error("Failed to fetch repos", data);
            }
        } catch (err) {
            console.error("Failed to fetch repos", err);
        } finally {
            setLoading(false);
        }
    };

    /** Each repository's files into a new folder of its own, inside parent. Returns the problems. */
    const copyToDevice = async (parent, list) => {
        const problems = [];
        for (const [i, repo] of list.entries()) {
            const label = `${repo.name} (${i + 1} of ${list.length})`;
            try {
                setProgress(`Downloading ${label}…`);
                const [owner, name] = repo.full_name.split("/");
                const res = await fetch(`${API_BASE}/github/repos/${owner}/${name}/tarball${repo.default_branch ? `?ref=${encodeURIComponent(repo.default_branch)}` : ""}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem("continuum_token")}` },
                });
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `the server answered ${res.status}`);
                const files = await filesOfTarball(res);
                const folder = await createProjectFolder(parent, repo.name);
                await writeFiles(folder.handle, files, (done, total) => setProgress(`Writing ${label}: ${done} of ${total} files…`));
            } catch (err) {
                problems.push(`${repo.name}: ${err.message}`);
            }
        }
        setProgress("");
        return problems;
    };

    const handleImport = async () => {
        setProblem("");
        try {
            // Selection holds repo ids (see toggleRepo / Select All)
            const selectedRepos = repos.filter((r) =>
                selected.includes(r.id)
            );

            // Where the folders go: asked first (the browser only opens its picker straight after a click)
            let parent = null;
            if (makeFolders) {
                parent = await pickParentFolder();
                if (!parent) {
                    setProblem("Choose where the folders go, or untick “Create a folder on this device”.");
                    return;
                }
            }

            const res = await fetch(`${API_BASE}/github/import`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("continuum_token")}`,
                },
                body: JSON.stringify({ repos: selectedRepos }),
            });

            if (!res.ok) {
                console.error("Import failed", await res.json().catch(() => ({})));
                return;
            }

            if (parent) {
                const problems = await copyToDevice(parent, selectedRepos);
                if (problems.length) {
                    // The projects are imported; say which folders couldn't be filled, and stay here
                    await onImported?.();
                    setProblem(`Imported, but some folders couldn't be made: ${problems.join("; ")}`);
                    return;
                }
            }

            // Show the imported projects without reloading the page
            await onImported?.();

            onDone?.();

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

                            <DeviceFolderOption
                                checked={makeFolders}
                                onChange={setMakeFolders}
                                disabled={Boolean(progress)}
                                hint="You choose where; each repository gets its own folder with its files (no git history)."
                            />

                            {progress && <p className="github-import-progress">{progress}</p>}
                            {problem && <p className="github-import-problem">{problem}</p>}

                            <button
                                onClick={handleImport}
                                disabled={selected.length === 0 || Boolean(progress)}
                                className="github-auth-btn"
                            >
                                {progress
                                    ? "Copying to your device…"
                                    : selected.length === 0
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