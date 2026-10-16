import { useEffect, useState } from "react";
import { useData } from "../../data/dataContext";
import { dataApi } from "../../data/dataApi";
import { LabelBars, Histogram } from "./Charts";
import { bytes, clock, compact, count, EXPORT_LABEL, percent, seconds, STEP_LABEL } from "./dataDisplay";
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
        <button type="button" role="tab" aria-selected={tab === "quality"} className={tab === "quality" ? "is-on" : ""} onClick={() => setTab("quality")}>Quality</button>
        <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "is-on" : ""} onClick={() => setTab("log")}>Log</button>
      </div>
      {!d ? (
        <p className="data-hint">Open a dataset to see what it holds: how many rows, which labels, gaps and copies.</p>
      ) : tab === "profile" ? (
        <Profile dataset={d} />
      ) : tab === "quality" ? (
        <Quality dataset={d} />
      ) : (
        <RunLog dataset={d} />
      )}
    </div>
  );
}

/** The version the Workbench shows (the newest unless another is picked). */
function useShownVersion(dataset) {
  const data = useData();
  const list = data.versions[dataset.id];
  const pick = data.versionPick[dataset.id];
  return list?.find((v) => v.id === pick) ?? list?.[0] ?? null;
}

function Profile({ dataset }) {
  const data = useData();
  const version = useShownVersion(dataset);
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
                <span className="data-finding-body">
                  {f.message}
                  {f.suggest && data.catalog?.steps?.[f.suggest]?.modalities.includes(version.modality) && dataset.state !== "building" && (
                    <button type="button" className="data-btn data-fix" onClick={() => data.addStep(dataset.id, f.suggest)}>
                      Fix this: {data.catalog.steps[f.suggest].label}
                    </button>
                  )}
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

      {profile.media?.kind === "image" && (
        <section>
          <h3 className="data-sub">
            Picture sizes <span className="data-sub-note">{profile.media.distinctSizes === 1 ? "all the same" : `${compact(profile.media.distinctSizes)} different`}</span>
          </h3>
          <ul className="data-kv">
            {profile.media.sizes.slice(0, 5).map((z) => (
              <li key={`${z.width}x${z.height}`}>
                <span>{z.width} × {z.height}</span>
                <span>{count(z.count)}</span>
              </li>
            ))}
          </ul>
          {profile.media.distinctSizes > 1 && <Histogram bins={profile.media.histogram} unit=" px" label="How wide the pictures are, in pixels" />}
        </section>
      )}

      {profile.media?.kind === "audio" && (
        <section>
          <h3 className="data-sub">
            Clip lengths <span className="data-sub-note">{profile.media.totalHours} hours in all</span>
          </h3>
          <Histogram bins={profile.media.histogram} unit=" s" label="How long the clips are, in seconds" />
          <ul className="data-kv">
            <li><span>Middle length</span><span>{seconds(profile.media.duration?.p50)}</span></li>
            {profile.media.sampleRates.map((r) => (
              <li key={r.rate}><span>{count(r.rate)} samples a second</span><span>{count(r.count)}</span></li>
            ))}
          </ul>
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

function Quality({ dataset }) {
  const data = useData();
  const version = useShownVersion(dataset);
  const [format, setFormat] = useState("hf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!version) return <p className="data-hint">No version yet.</p>;
  const q = version.quality;
  const formats = data.catalog?.exportFormatsFor?.[version.modality] ?? data.catalog?.exportFormats ?? ["hf", "parquet", "csv", "jsonl"];
  const exported = version.exports?.[format];
  const exporting = !exported && data.exporting[`${version.id}:${format}`];

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data-profile">
      <h3 className="data-sub">Version {version.number}{version.frozen && <span className="data-tag">published</span>}</h3>
      {q ? (
        <>
          <div className={`data-score verdict-${q.score >= 85 ? "good" : q.score >= 60 ? "ok" : "poor"}`}>
            <span className="data-score-value">{q.score}</span>
            <span className="data-score-text">
              <strong>{q.verdict}</strong>
              <span>{q.passed} of {q.total} checks passed</span>
            </span>
          </div>
          <ul className="data-gates">
            {q.gates.map((g) => (
              <li key={g.id} className={g.passed ? "is-pass" : "is-fail"}>
                <span className="data-gate-icon" aria-label={g.passed ? "passed" : "not passed"}>{g.passed ? "✓" : "✕"}</span>
                <span className="data-finding-body">
                  <strong>{g.title}</strong> {g.reason}
                  {!g.passed && g.fix && data.catalog?.steps?.[g.fix]?.modalities.includes(version.modality) && dataset.state !== "building" && (
                    <button type="button" className="data-btn data-fix" onClick={() => data.addStep(dataset.id, g.fix)}>
                      Fix this: {data.catalog.steps[g.fix].label}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="data-hint">This version hasn't been checked yet. A clean-up with the "Check quality" step gives it a score from 0 to 100.</p>
          {dataset.state !== "building" && (
            <button type="button" className="data-btn" onClick={() => data.addStep(dataset.id, "validate")}>Add a quality check</button>
          )}
        </>
      )}

      <section>
        <h3 className="data-sub">Use it</h3>
        <div className="data-set">
          <label htmlFor="export-format">Download as</label>
          <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => (
              <option key={f} value={f}>{EXPORT_LABEL[f] ?? f}</option>
            ))}
          </select>
        </div>
        <div className="data-actions">
          {exported ? (
            <button type="button" className="data-btn is-primary" disabled={busy} onClick={() => act(() => dataApi.download(version.id, format))}>
              Download ({bytes(exported.bytes)})
            </button>
          ) : (
            <button type="button" className="data-btn" disabled={busy || exporting} onClick={() => act(() => data.exportVersion(dataset, version.id, format))}>
              {exporting ? "Packing…" : "Make download"}
            </button>
          )}
          {!version.frozen && (
            <button type="button" className="data-btn" disabled={busy} onClick={() => act(() => data.publish(dataset, version.id))} title="Marks this version as the one to train on. It can't be changed after that.">
              Publish this version
            </button>
          )}
        </div>
        <p className="data-hint">
          {version.frozen ? "This is the version to train on. It won't change." : "Publishing marks this version as the one to train on. Downloads carry a README with its sources and licences."}
        </p>
        {error && <p className="data-error">{error}</p>}
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
