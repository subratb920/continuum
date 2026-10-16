import { useEffect, useState } from "react";
import { useData } from "../../data/dataContext";
import { dataApi } from "../../data/dataApi";
import { LabelBars, Histogram } from "./Charts";
import { clock, compact, count, percent, STEP_LABEL } from "./dataDisplay";
import "./data.css";

/**
 * Inspector (right): what the open dataset holds (its profile, in plain
 * words) and what its build did (the run log, live).
 */
export default function DataInspector() {
  const data = useData();
  const [tab, setTab] = useState("profile");
  if (!data) return null;
  const d = data.selected;
  return (
    <div className="data-inspector">
      <div className="data-tabs" role="tablist" aria-label="Inspector">
        <button type="button" role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? "is-on" : ""} onClick={() => setTab("profile")}>Profile</button>
        <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "is-on" : ""} onClick={() => setTab("log")}>Build log</button>
      </div>
      {!d ? (
        <p className="data-hint">Open a dataset to see what it holds: how many rows, which labels, gaps and copies.</p>
      ) : tab === "profile" ? (
        <Profile dataset={d} />
      ) : (
        <RunLog dataset={d} />
      )}
    </div>
  );
}

function Profile({ dataset }) {
  const data = useData();
  const version = data.versions[dataset.id]?.[0] ?? null;
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const ready = Boolean(version?.profileSummary);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    dataApi
      .profile(version.id)
      .then((p) => live && (setProfile(p), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [version?.id, ready]);

  if (!version || !ready) return <p className="data-hint">{dataset.state === "building" ? "The profile appears when the build has measured the data." : "No profile yet."}</p>;
  if (error) return <p className="data-error">{error}</p>;
  if (!profile) return <p className="data-hint">Loading…</p>;

  const cols = profile.columns?.filter((c) => !c.name.startsWith("_")) ?? [];
  const lengths = profile.text?.histogram;
  return (
    <div className="data-profile">
      <div className="data-tiles">
        <Tile label="Rows" value={compact(profile.rows)} />
        <Tile label="Columns" value={cols.length} />
        <Tile label="Exact copies" value={compact(profile.duplicates?.exact ?? 0)} />
        <Tile label="Empty cells" value={compact(profile.missing?.cells ?? 0)} />
        {profile.text && <Tile label="Words (about)" value={compact(Math.round((profile.text.tokensApprox ?? 0) / 1.3))} />}
      </div>
      {profile.sampled < profile.rows && <p className="data-hint">Measured on {count(profile.sampled)} of {count(profile.rows)} rows.</p>}

      {profile.findings?.length > 0 && (
        <section>
          <h3 className="data-sub">What we noticed</h3>
          <ul className="data-findings">
            {profile.findings.map((f) => (
              <li key={f.id} className={`finding-${f.severity}`}>
                <span className="data-finding-icon" aria-label={f.severity}>{f.severity === "warning" ? "⚠" : "ℹ"}</span>
                <span>
                  {f.message}
                  {f.suggest && <span className="data-finding-next"> Fixing this comes with the clean-up steps in the next update.</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.labels?.counts?.length > 0 && (
        <section>
          <h3 className="data-sub">
            Rows per label <span className="data-sub-note">balance {Math.round((profile.labels.balance ?? 0) * 100)}%</span>
          </h3>
          <LabelBars counts={profile.labels.counts.slice(0, 20)} total={profile.rows} />
          {profile.labels.counts.length > 20 && <p className="data-hint">And {profile.labels.counts.length - 20} more labels.</p>}
        </section>
      )}

      {lengths?.length > 0 && (
        <section>
          <h3 className="data-sub">
            Text length <span className="data-sub-note">median {compact(profile.text.chars?.p50)} characters</span>
          </h3>
          <Histogram bins={lengths} label="How long the texts are, in characters" />
        </section>
      )}

      {profile.splits && (
        <section>
          <h3 className="data-sub">Splits</h3>
          <ul className="data-kv">
            {Object.entries(profile.splits).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span>{count(v)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="data-sub">Columns</h3>
        <table className="data-coltable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Empty</th>
              <th>Different</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.name}>
                <td title={c.role}>{c.name}{c.role === "label" && <span className="data-tag">label</span>}</td>
                <td>{c.type}</td>
                <td>{percent(c.missing, profile.sampled)}</td>
                <td>{compact(c.distinct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="data-tile">
      <span className="data-tile-label">{label}</span>
      <span className="data-tile-value">{value}</span>
    </div>
  );
}

function RunLog({ dataset }) {
  const data = useData();
  const run = dataset.lastRun;
  const list = run ? data.events[run.id] : null;

  useEffect(() => {
    if (run) data.loadEvents(run.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  if (!run) return <p className="data-hint">No build yet.</p>;
  const shown = (list ?? []).filter((e) => e.kind !== "progress");
  return (
    <div className="data-log">
      {!data.connected && <p className="data-hint">Reconnecting to live updates…</p>}
      <ol>
        {shown.map((e) => (
          <li key={e.id} className={`log-${e.kind}`}>
            <time>{clock(e.at)}</time>
            <span>
              {e.stepIndex !== null && e.kind !== "state" && <em>{STEP_LABEL[run.steps[e.stepIndex]?.op] ?? ""}: </em>}
              {e.message}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
