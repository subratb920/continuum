import { useEffect, useState } from "react";
import { fetchProjects } from "../../api";
import "./skills.css";

/** Continuum's own skills, in every agent of that kind (shown, not editable). */
const BUILT_IN = [
  { name: "plan-scopes", for: "brain", description: "Split goals into tasks and give each worker its own files." },
  { name: "review-work", for: "brain", description: "Review a worker's report and diff before marking it done." },
  { name: "settle-clashes", for: "brain", description: "Decide merge clashes after your final review approval." },
  { name: "final-report", for: "workers", description: "Report what changed, which checks ran, what's left." },
  { name: "run-checks", for: "workers", description: "Find and run the right tests, build and lint." },
];
const FOR_LABEL = { brain: "Brain", workers: "Workers", both: "Brain and workers" };
const EMPTY = { name: "", description: "", body: "", for: "workers", projects: [] };

/**
 * Skills: know-how an agent loads only when its description fits the work
 * (only the name and "when to use it" are always in its prompt). Yours go to
 * the brain, to workers (on every project, or some), or both; agents get
 * them the next time they start.
 */
export default function SkillsDialog({ brain, onClose }) {
  const [list, setList] = useState(null);
  const [projects, setProjects] = useState([]);
  const [draft, setDraft] = useState(null); // the skill being added or changed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => brain.skills().then(setList, (err) => setError(err.message || "Your skills couldn't be loaded."));
  useEffect(() => {
    load();
    fetchProjects().then(setProjects, () => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const projectName = (id) => projects.find((p) => String(p._id) === id)?.name ?? `project ${id.slice(-4)}`;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await brain.saveSkill({ ...draft, projects: draft.for === "brain" ? [] : draft.projects });
      setDraft(null);
      await load();
    } catch (err) {
      setError(err.message || "The skill couldn't be saved.");
    }
    setBusy(false);
  }

  async function remove(s) {
    setBusy(true);
    setError("");
    try {
      await brain.deleteSkill(s.id);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err.message || "The skill couldn't be deleted.");
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop skills-backdrop">
      <div className="modal-window skills-dialog" role="dialog" aria-label="Skills">
        <header className="modal-header">
          <h2>Skills</h2>
          <button type="button" className="draft-fold-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <section className="modal-body skills-body">
          <p className="brain-hint">
            An agent always sees only each skill's name and when to use it; it loads the instructions when the work fits. Changes apply to agents started from now on.
          </p>

          {!draft && (
            <>
              <h3 className="skills-h">Yours</h3>
              {list === null && !error && <p className="brain-hint">Loading…</p>}
              {list?.length === 0 && <p className="brain-hint">None yet. Add one for how your projects do things: conventions, checks, deploy steps.</p>}
              <ul className="skills-list">
                {list?.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="skills-item" onClick={() => setDraft({ ...s })}>
                      <span className="skills-name">{s.name}</span>
                      <span className="skills-for">
                        {FOR_LABEL[s.for]}
                        {s.for !== "brain" && s.projects.length ? ` · ${s.projects.map(projectName).join(", ")}` : ""}
                      </span>
                      <span className="skills-desc">{s.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="brain-btn is-primary" onClick={() => setDraft({ ...EMPTY })}>
                + Add a skill
              </button>

              <h3 className="skills-h">Continuum's own</h3>
              <ul className="skills-list is-built-in">
                {BUILT_IN.map((s) => (
                  <li key={s.name}>
                    <span className="skills-name">{s.name}</span>
                    <span className="skills-for">{FOR_LABEL[s.for]}</span>
                    <span className="skills-desc">{s.description}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {draft && (
            <form className="skills-form" onSubmit={save}>
              <label>
                Name
                <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="api-conventions" pattern="[a-z0-9][a-z0-9-]{0,63}" required />
                <span className="brain-hint">Lowercase letters, digits and hyphens.</span>
              </label>
              <label>
                When to use it
                <input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Use when adding or changing a route in continuum-api." maxLength={500} required />
                <span className="brain-hint">The agent always sees this line: make it say clearly when the skill fits.</span>
              </label>
              <label>
                Instructions
                <textarea rows={12} value={draft.body} onChange={(e) => set({ body: e.target.value })} placeholder={"1. …\n2. …"} maxLength={20000} required />
              </label>
              <fieldset className="skills-for-choice">
                <legend>Who gets it</legend>
                {["workers", "brain", "both"].map((f) => (
                  <label key={f}>
                    <input type="radio" name="for" checked={draft.for === f} onChange={() => set({ for: f })} /> {FOR_LABEL[f]}
                  </label>
                ))}
              </fieldset>
              {draft.for !== "brain" && projects.length > 0 && (
                <fieldset className="skills-projects">
                  <legend>Workers on (none ticked: every project)</legend>
                  {projects.map((p) => (
                    <label key={String(p._id)}>
                      <input
                        type="checkbox"
                        checked={draft.projects.includes(String(p._id))}
                        onChange={(e) => set({ projects: e.target.checked ? [...draft.projects, String(p._id)] : draft.projects.filter((x) => x !== String(p._id)) })}
                      />{" "}
                      {p.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="agent-spawn-actions">
                {draft.id && (
                  <button type="button" className="brain-btn skills-delete" onClick={() => remove(draft)} disabled={busy}>
                    Delete
                  </button>
                )}
                <button type="button" className="brain-btn" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="brain-btn is-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          )}
          {error && <p className="model-settings-error" role="alert">{error}</p>}
        </section>
      </div>
    </div>
  );
}
