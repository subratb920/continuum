import { useCallback, useEffect, useState } from "react";
import { checkGithubRepoName, createWorkspace, deleteWorkspace, fetchGithubCreateStatus, fetchWorkspaces, openWorkspace, putProjectOnGithub, stopWorkspace } from "../api";
import { formatBytes } from "../utils/importFromDevice";
import { tarGzOf } from "../utils/tarWriter";
import { formatDateTime } from "../utils/time";
import "./Workspaces.css";

/** What each size gets, and roughly what an hour of use costs */
const SIZES = [
  { id: "small", label: "Small", spec: "1 CPU · 2 GB", hint: "Editing and small apps" },
  { id: "standard", label: "Standard", spec: "2 CPU · 4 GB", hint: "Most projects" },
  { id: "large", label: "Large", spec: "4 CPU · 8 GB", hint: "Big builds (Java, Spring)" },
];

/** The tools a Continuum workspace starts with (the server says which this Continuum offers) */
const SANDBOXES = [
  { id: "full", label: "Full", spec: "Node · Python · Java", hint: "Any starter project" },
  { id: "node", label: "Node", spec: "Node 22", hint: "React, Express, Next" },
  { id: "python", label: "Python", spec: "Python 3", hint: "FastAPI, Django, scripts" },
  { id: "java", label: "Java", spec: "Java 21 · Maven", hint: "Spring Boot" },
];

/**
 * Where to work on a project. Continuum runs its own workspaces; the others
 * open the project's GitHub repository on their site (url(repo, branch)).
 */
const PROVIDERS = [
  {
    id: "continuum",
    label: "Continuum",
    about: "VS Code in your browser, run by Continuum, with a terminal, the sandbox and size you choose. It stops by itself after 30 minutes with no editor open; its files stay until you delete it. Push your work to GitHub from inside it.",
  },
  {
    id: "codespaces",
    label: "GitHub Codespaces",
    about: "VS Code with a terminal on GitHub's machines; it reads the repository's .devcontainer if there is one.",
    needs: "A GitHub account. GitHub bills your account once its free monthly hours are used.",
    url: (repo, branch) => `https://codespaces.new/${repo}${branch ? `/tree/${encodeURIComponent(branch)}` : ""}?quickstart=1`,
  },
  {
    id: "gitpod",
    label: "Gitpod",
    about: "A cloud development environment with a terminal; it reads the repository's .gitpod.yml or .devcontainer.",
    needs: "A Gitpod account (sign in with GitHub). Gitpod bills your account beyond its free use.",
    url: (repo, branch) => `https://gitpod.io/#https://github.com/${repo}${branch ? `/tree/${encodeURIComponent(branch)}` : ""}`,
  },
  {
    id: "stackblitz",
    label: "StackBlitz",
    about: "Runs the project inside your browser (no server), so it starts in seconds.",
    needs: "Best for Node and web projects (React, Vite, Next). Sign in to StackBlitz to save changes.",
    url: (repo, branch) => `https://stackblitz.com/github/${repo}${branch ? `/tree/${encodeURIComponent(branch)}` : ""}`,
  },
  {
    id: "codesandbox",
    label: "CodeSandbox",
    about: "A cloud sandbox with a terminal and a preview of the running app.",
    needs: "A CodeSandbox account to save and run changes.",
    url: (repo, branch) => `https://codesandbox.io/p/github/${repo}${branch ? `/${encodeURIComponent(branch)}` : ""}`,
  },
  {
    id: "githubdev",
    label: "github.dev",
    about: "A light VS Code in the browser for quick edits and commits.",
    needs: "Free with a GitHub account. No terminal: code can't be run there.",
    url: (repo, branch) => `https://github.dev/${repo}${branch ? `/tree/${encodeURIComponent(branch)}` : ""}`,
  },
  {
    id: "vscode",
    label: "VS Code (this computer)",
    about: "Clones the repository into VS Code on this computer.",
    needs: "VS Code installed here; it asks where to put the copy. It opens the default branch.",
    url: (repo) => `vscode://vscode.git/clone?url=${encodeURIComponent(`https://github.com/${repo}.git`)}`,
    noBranch: true,
  },
];

// The provider chosen last time (this browser)
const PROVIDER_KEY = "continuum.workspaceProvider";
function savedProvider() {
  try {
    const id = localStorage.getItem(PROVIDER_KEY);
    return PROVIDERS.some((p) => p.id === id) ? id : "continuum";
  } catch {
    return "continuum";
  }
}

const STATE = {
  running: ["Running", "is-running"],
  starting: ["Starting…", "is-starting"],
  stopped: ["Stopped", "is-stopped"],
  unknown: ["Unknown", "is-stopped"],
};

/** owner/name of a project's GitHub repository, or null */
function repoOf(p) {
  if (p.fullName) return p.fullName;
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(p.githubRepoUrl ?? "");
  return m ? m[1] : null;
}

/**
 * Continuum Workspaces: a development server per project (VS Code in the
 * browser, with the project's GitHub repository, a terminal and its tools).
 * It stops by itself after 30 minutes with no editor open; the code stays
 * until the workspace is deleted. Works the same on a phone.
 */
export default function Workspaces({ projects, initialProjectId = null, selectedProjectId = null, onProjectChanged }) {
  const [data, setData] = useState(null); // { items, limits }
  const [loadError, setLoadError] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  // A project picked in the Projects pane becomes the one to open
  const [followed, setFollowed] = useState(selectedProjectId);
  if (selectedProjectId && selectedProjectId !== followed) {
    setFollowed(selectedProjectId);
    setProjectId(selectedProjectId);
  }
  const [size, setSize] = useState("standard");
  const [sandbox, setSandbox] = useState("full");
  const [busy, setBusy] = useState(null); // { id, action } (id "new": the new workspace)
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [nextSize, setNextSize] = useState({}); // workspace id → size for its next start
  const [nextSandbox, setNextSandbox] = useState({}); // workspace id → sandbox for its next start
  const [providerId, setProviderId] = useState(savedProvider);
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
  function chooseProvider(id) {
    setProviderId(id);
    try {
      localStorage.setItem(PROVIDER_KEY, id);
    } catch {
      // private window: chosen for now only
    }
  }

  const load = useCallback(async () => {
    try {
      setData(await fetchWorkspaces());
      setLoadError("");
    } catch (e) {
      setLoadError(e.message === "UNAUTHORIZED" ? "Sign in again to see your workspaces." : e.message);
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetchWorkspaces()
      .then((d) => live && setData(d))
      .catch((e) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // While one starts, follow it
  const starting = data?.items.some((w) => w.state === "starting");
  useEffect(() => {
    if (!starting) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [starting, load]);

  // Every project can have one: those without a GitHub repository are put on GitHub first
  const taken = new Set((data?.items ?? []).map((w) => w.projectId));
  const choices = projects.filter((p) => !taken.has(p._id));
  const chosen = choices.find((p) => p._id === projectId) ?? null;
  const needsGithub = Boolean(chosen && !repoOf(chosen));

  /**
   * Opens the editor in a new tab. The tab is opened straight away (browsers
   * only allow it right after a click) and pointed at the editor once it's ready.
   */
  async function open(id, chosenSize, chosenSandbox) {
    setError("");
    setBusy({ id, action: "open" });
    const tab = window.open("", "_blank");
    try {
      const { url } = await openWorkspace(id, chosenSize, chosenSandbox);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      await load();
    } catch (e) {
      tab?.close();
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function createAndOpen() {
    setError("");
    setBusy({ id: "new", action: "open" });
    const tab = window.open("", "_blank");
    try {
      const w = await createWorkspace(projectId, size, sandbox);
      const { url } = await openWorkspace(w.id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setProjectId("");
      await load();
    } catch (e) {
      tab?.close();
      setError(e.message);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function act(id, fn, action) {
    setError("");
    setBusy({ id, action });
    try {
      await fn(id);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ws-page">
      <header className="ws-head">
        <h1>{provider.label} Workspace</h1>
        <p className="ws-muted">{provider.about}</p>
      </header>

      <fieldset className="ws-providers">
        <legend className="ws-label">Workspace</legend>
        {PROVIDERS.map((p) => (
          <label key={p.id} className={`ws-provider${p.id === provider.id ? " is-selected" : ""}`}>
            <input type="radio" name="ws-provider" checked={p.id === provider.id} onChange={() => chooseProvider(p.id)} />
            {p.label}
          </label>
        ))}
      </fieldset>

      {provider.id !== "continuum" && (
        <ExternalWorkspace key={provider.id} provider={provider} projects={projects} projectId={projectId} onProjectId={setProjectId} onProjectChanged={onProjectChanged} />
      )}

      {provider.id === "continuum" && loadError && (
        <p className="ws-error" role="alert">
          {loadError}
        </p>
      )}
      {provider.id === "continuum" && error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}

      {provider.id === "continuum" && data && (
        <>
          <section className="ws-card ws-new" aria-label="New workspace">
            <h2>New workspace</h2>
            {projects.length === 0 ? (
              <p className="ws-muted">Create or import a project first.</p>
            ) : choices.length === 0 ? (
              <p className="ws-muted">Every project has a workspace.</p>
            ) : (
              <>
                <label className="ws-field">
                  <span className="ws-label">Project</span>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">Choose a project…</option>
                    {choices.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} ({repoOf(p) ?? "not on GitHub yet"})
                      </option>
                    ))}
                  </select>
                </label>
                {needsGithub ? (
                  <PutOnGithub key={chosen._id} project={chosen} onDone={(p) => onProjectChanged?.(p)} />
                ) : (
                  <>
                    <div className="ws-pickers">
                      <SandboxPicker value={sandbox} onChange={setSandbox} offered={data.sandboxes ?? ["full"]} />
                      <SizePicker value={size} onChange={setSize} name="new-size" />
                    </div>
                    <button type="button" className="ws-btn ws-btn-primary" onClick={createAndOpen} disabled={!projectId || busy?.id === "new"}>
                      {busy?.id === "new" ? "Starting…" : "Create and open"}
                    </button>
                  </>
                )}
              </>
            )}
          </section>

          <section aria-label="Your workspaces">
            {data.items.length === 0 ? (
              <p className="ws-muted ws-empty">No workspaces yet.</p>
            ) : (
              <ul className="ws-list">
                {data.items.map((w) => {
                  const [label, tone] = STATE[w.state] ?? STATE.unknown;
                  const running = w.state === "running" || w.state === "starting";
                  return (
                    <li key={w.id} className="ws-card ws-item">
                      <div className="ws-item-top">
                        <span className="ws-item-name">{w.projectName}</span>
                        <span className={`ws-state ${tone}`}>{label}</span>
                      </div>
                      <span className="ws-muted ws-item-repo">{w.repo}</span>
                      <span className="ws-muted ws-item-meta">
                        {SANDBOXES.find((s) => s.id === w.sandbox)?.label ?? w.sandbox} sandbox · {SIZES.find((s) => s.id === w.size)?.label ?? w.size} ({SIZES.find((s) => s.id === w.size)?.spec}) ·{" "}
                        {w.lastOpenedAt ? `opened ${formatDateTime(w.lastOpenedAt)}` : "not opened yet"}
                      </span>

                      {confirmDelete === w.id ? (
                        <div className="ws-confirm" role="group" aria-label="Confirm delete">
                          <span>Delete this workspace and its files? Push anything you want to keep first; your GitHub repository stays.</span>
                          <div className="ws-actions">
                            <button type="button" className="ws-btn" onClick={() => setConfirmDelete(null)}>
                              Cancel
                            </button>
                            <button type="button" className="ws-btn ws-btn-danger" onClick={() => act(w.id, deleteWorkspace, "delete")} disabled={busy?.id === w.id}>
                              {busy?.id === w.id && busy.action === "delete" ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="ws-actions">
                          <button type="button" className="ws-btn ws-btn-primary" onClick={() => (running ? open(w.id) : open(w.id, nextSize[w.id], nextSandbox[w.id]))} disabled={busy?.id === w.id}>
                            {busy?.id === w.id && busy.action === "open" ? "Opening…" : "Open"}
                          </button>
                          {running && (
                            <button type="button" className="ws-btn" onClick={() => act(w.id, stopWorkspace, "stop")} disabled={busy?.id === w.id}>
                              {busy?.id === w.id && busy.action === "stop" ? "Stopping…" : "Stop"}
                            </button>
                          )}
                          {!running && (data.sandboxes ?? []).length > 1 && (
                            <select className="ws-size-select" aria-label="Sandbox when it starts" value={nextSandbox[w.id] ?? w.sandbox} onChange={(e) => setNextSandbox((n) => ({ ...n, [w.id]: e.target.value }))} disabled={busy?.id === w.id}>
                              {SANDBOXES.filter((s) => data.sandboxes.includes(s.id)).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label} · {s.spec}
                                </option>
                              ))}
                            </select>
                          )}
                          {!running && (
                            <select className="ws-size-select" aria-label="Size when it starts" value={nextSize[w.id] ?? w.size} onChange={(e) => setNextSize((n) => ({ ...n, [w.id]: e.target.value }))} disabled={busy?.id === w.id}>
                              {SIZES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label} · {s.spec}
                                </option>
                              ))}
                            </select>
                          )}
                          <button type="button" className="ws-btn ws-btn-quiet" onClick={() => setConfirmDelete(w.id)} disabled={busy?.id === w.id}>
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="ws-muted ws-limits">One workspace per project; {data.limits.running} runs at a time.</p>
          </section>
        </>
      )}

      {provider.id === "continuum" && !data && !loadError && <p className="ws-muted">Loading…</p>}
    </div>
  );
}

function SizePicker({ value, onChange, name }) {
  return (
    <fieldset className="ws-sizes">
      <legend className="ws-label">Size</legend>
      {SIZES.map((s) => (
        <label key={s.id} className={`ws-size${value === s.id ? " is-selected" : ""}`}>
          <input type="radio" name={name} checked={value === s.id} onChange={() => onChange(s.id)} />
          <span className="ws-size-name">{s.label}</span>
          <span className="ws-size-spec">{s.spec}</span>
          <span className="ws-size-hint">{s.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The sandbox a new workspace starts with: only those this Continuum offers. */
function SandboxPicker({ value, onChange, offered }) {
  const choices = SANDBOXES.filter((s) => offered.includes(s.id));
  if (choices.length < 2) return null;
  return (
    <fieldset className="ws-sizes">
      <legend className="ws-label">Sandbox</legend>
      {choices.map((s) => (
        <label key={s.id} className={`ws-size${value === s.id ? " is-selected" : ""}`}>
          <input type="radio" name="new-sandbox" checked={value === s.id} onChange={() => onChange(s.id)} />
          <span className="ws-size-name">{s.label}</span>
          <span className="ws-size-spec">{s.spec}</span>
          <span className="ws-size-hint">{s.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Another provider's workspace: the project (on GitHub first if it isn't),
 * the branch, what the provider needs, then Open in <provider> (its site, in
 * a new tab; VS Code on this computer through its link).
 */
function ExternalWorkspace({ provider, projects, projectId, onProjectId, onProjectChanged }) {
  const [branch, setBranch] = useState("");
  const chosen = projects.find((p) => p._id === projectId) ?? null;
  const repo = chosen ? repoOf(chosen) : null;

  function openIt() {
    const url = provider.url(repo, branch.trim());
    if (url.startsWith("vscode:")) window.location.href = url;
    else window.open(url, "_blank", "noopener");
  }

  return (
    <section className="ws-card ws-new" aria-label={`New ${provider.label} workspace`}>
      <h2>New {provider.label} workspace</h2>
      <p className="ws-muted">{provider.needs}</p>
      {projects.length === 0 ? (
        <p className="ws-muted">Create or import a project first.</p>
      ) : (
        <>
          <label className="ws-field">
            <span className="ws-label">Project</span>
            <select value={projectId} onChange={(e) => onProjectId(e.target.value)}>
              <option value="">Choose a project…</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({repoOf(p) ?? "not on GitHub yet"})
                </option>
              ))}
            </select>
          </label>
          {chosen && !repo ? (
            <PutOnGithub key={chosen._id} project={chosen} onDone={(p) => onProjectChanged?.(p)} what={provider.label} />
          ) : (
            <>
              {repo && <p className="ws-muted">Repository: {repo}</p>}
              {!provider.noBranch && (
                <label className="ws-field">
                  <span className="ws-label">Branch</span>
                  <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="The default branch" spellCheck={false} />
                </label>
              )}
              <button type="button" className="ws-btn ws-btn-primary" onClick={openIt} disabled={!repo}>
                Open in {provider.label}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Never pushed: dependencies, git, build output, secrets (the server checks again). */
const LEFT_OUT = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;
const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * A project without a GitHub repository: a new repository on the user's
 * GitHub first (asked each time, Yes or No), with the project's folder as the
 * first commit (device projects, picked here) or a README to start from.
 */
function PutOnGithub({ project, onDone, what = "workspace" }) {
  const [answer, setAnswer] = useState(null); // null | "yes" | "no"
  const [name, setName] = useState(project.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "project");
  const [isPrivate, setIsPrivate] = useState(true);
  const [status, setStatus] = useState(null); // { connected, login, reason }
  const [check, setCheck] = useState(null); // { name, available } | { name, error }
  const [folder, setFolder] = useState(null); // { name, files: [{ path, file }], bytes, skipped }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetchGithubCreateStatus()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus({ connected: false, reason: "GitHub couldn't be checked." }));
    return () => {
      live = false;
    };
  }, []);

  const valid = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/.test(name) && !name.endsWith(".git");
  useEffect(() => {
    if (answer !== "yes" || !valid || !status?.connected) return;
    let live = true;
    const t = setTimeout(() => {
      checkGithubRepoName(name)
        .then((r) => live && setCheck({ name, available: r.available }))
        .catch((e) => live && setCheck({ name, error: e.message }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [answer, name, valid, status?.connected]);

  /** The project's folder on this device: read here, sent as one archive */
  function pickFolder() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";
    input.addEventListener("change", () => {
      const all = [...(input.files ?? [])];
      input.remove();
      if (!all.length) return;
      const top = (all[0].webkitRelativePath || all[0].name).split("/")[0];
      const files = [];
      let skipped = 0;
      for (const file of all) {
        const rel = file.webkitRelativePath || file.name;
        const path = rel.startsWith(`${top}/`) ? rel.slice(top.length + 1) : rel;
        if (!path || LEFT_OUT.test(path)) {
          skipped += 1;
          continue;
        }
        files.push({ path, file });
      }
      setFolder({ name: top, files, bytes: files.reduce((n, f) => n + f.file.size, 0), skipped });
    });
    document.body.appendChild(input);
    input.click();
  }

  const tooBig = folder && (folder.files.length > MAX_FILES || folder.bytes > MAX_BYTES);
  const ready = answer === "yes" && status?.connected && valid && check?.name === name && check.available && !tooBig;

  async function put() {
    setError("");
    try {
      setBusy(folder ? "Packing the folder…" : "Creating the repository…");
      const archive = folder ? await tarGzOf(folder.files) : null;
      setBusy("Creating the repository and pushing…");
      const { project: changed } = await putProjectOnGithub(project._id, { name, isPrivate }, archive);
      onDone({ ...project, ...changed });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="ws-github">
      <p className="ws-muted">
        <strong>{project.name}</strong> isn&apos;t on GitHub yet. A {what === "workspace" ? "workspace" : `${what} workspace`} works on the project&apos;s GitHub repository, so it gets one first.
      </p>
      <fieldset className="ws-question">
        <legend className="ws-label">Create a repository on your GitHub for it?</legend>
        <label className={`ws-choice${answer === "yes" ? " is-selected" : ""}${status?.connected ? "" : " is-disabled"}`}>
          <input type="radio" name="put-github" checked={answer === "yes"} disabled={!status?.connected} onChange={() => setAnswer("yes")} /> Yes, create it
        </label>
        <label className={`ws-choice${answer === "no" ? " is-selected" : ""}`}>
          <input type="radio" name="put-github" checked={answer === "no"} onChange={() => setAnswer("no")} /> No
        </label>
      </fieldset>
      {status && !status.connected && <p className="ws-muted">{status.reason}</p>}
      {answer === "no" && <p className="ws-muted">Then this project can&apos;t have a workspace. Choose another project, or come back when you&apos;d like it on GitHub.</p>}

      {answer === "yes" && status?.connected && (
        <>
          <label className="ws-field">
            <span className="ws-label">Repository</span>
            <span className="ws-repo">
              <span className="ws-muted">{status.login}/</span>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!valid || check?.available === false} />
            </span>
            <span className={!valid || check?.available === false || check?.error ? "ws-field-error" : "ws-muted"}>
              {!valid ? "Letters, digits, '-', '.', '_' (up to 100)." : check?.name !== name ? "Checking…" : check.error ? check.error : check.available ? "Available" : "You already have a repository with this name."}
            </span>
          </label>
          <div className="ws-question" role="radiogroup" aria-label="Visibility">
            {[
              [true, "Private"],
              [false, "Public"],
            ].map(([value, label]) => (
              <label key={label} className={`ws-choice${isPrivate === value ? " is-selected" : ""}`}>
                <input type="radio" name="put-visibility" checked={isPrivate === value} onChange={() => setIsPrivate(value)} /> {label}
              </label>
            ))}
          </div>

          {project.source === "device" ? (
            <div className="ws-folder">
              <button type="button" className="ws-btn" onClick={pickFolder} disabled={Boolean(busy)}>
                {folder ? "Choose another folder" : "Choose the project's folder…"}
              </button>
              <span className="ws-muted">
                {folder
                  ? `${folder.name}: ${folder.files.length} files, ${formatBytes(folder.bytes)} (${folder.skipped} left out: dependencies, git, build output, .env files)`
                  : "Its files become the first commit. Without a folder, the repository starts with a README."}
              </span>
              {tooBig && <span className="ws-field-error">That&apos;s more than {MAX_FILES} files or 50 MB: push it to GitHub yourself, then import it.</span>}
            </div>
          ) : (
            <p className="ws-muted">The repository starts with a README; add your code in the workspace.</p>
          )}

          <button type="button" className="ws-btn ws-btn-primary" onClick={put} disabled={!ready || Boolean(busy)}>
            {busy || "Put on GitHub"}
          </button>
        </>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
