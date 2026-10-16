import { useEffect, useRef, useState } from "react";
import { useData } from "../../data/dataContext";
import { dataApi } from "../../data/dataApi";
import { AddLink, SourceSearchBox } from "./DataLibrary";
import DataPipeline from "./DataPipeline";
import { useSourceSearch } from "./useSourceSearch";
import {
  bytes,
  cellText,
  CONNECTOR_LABEL,
  compact,
  count,
  MODALITY_ICON,
  MODALITY_LABEL,
  READY_MODALITIES,
  STATE_LABEL,
  STEP_HINT,
  STEP_LABEL,
  TASK_LABEL,
  UPLOAD_TYPES,
} from "./dataDisplay";
import "./data.css";

/**
 * Workbench (centre): start a dataset (from a source or your own files),
 * follow its build step by step, and look through its rows.
 */
export default function DataWorkbench() {
  const data = useData();
  if (!data) return null;
  return (
    <div className="data-bench">
      {data.selected ? <DatasetView key={data.selected.id} dataset={data.selected} /> : data.pendingSource ? <SourceForm key={data.pendingSource.id} source={data.pendingSource} /> : <StartView />}
    </div>
  );
}

/* ---------- Start: find data, or bring your own ---------- */

function StartView() {
  const data = useData();
  const search = useSourceSearch();
  return (
    <div className="data-start">
      <header className="data-start-head">
        <h1>Make a dataset</h1>
        <p>Pick data to start from, or bring your own files. Continuum downloads it, tidies it into one table, and measures it, so you can see what you have before you train a model on it.</p>
      </header>

      <section className="data-card">
        <h2 className="data-card-title">Start from a known source</h2>
        <SourceSearchBox search={search} />
        <AddLink onAdded={(s) => data.chooseSource(s)} />
        {search.liveError && <p className="data-hint">{search.liveError}</p>}
        <div className="data-source-grid">
          {search.sources.slice(0, 12).map((s) => (
            <SourceCard key={s.id} source={s} onUse={() => data.chooseSource(s)} />
          ))}
        </div>
        {!search.loading && !search.sources.length && <p className="data-hint">Nothing found. Try other words.</p>}
      </section>

      <section className="data-card">
        <h2 className="data-card-title">Or use your own files</h2>
        <UploadForm />
      </section>
    </div>
  );
}

function SourceCard({ source: s, onUse }) {
  const ready = s.modalities.some((m) => READY_MODALITIES.includes(m));
  return (
    <article className="data-source">
      <div className="data-source-top">
        <span className="data-source-icon" aria-hidden="true">{MODALITY_ICON[s.modalities[0]] ?? "?"}</span>
        <h3>{s.title}</h3>
      </div>
      <p className="data-source-desc">{s.description || s.ref}</p>
      <p className="data-source-meta">
        {CONNECTOR_LABEL[s.connector] ?? s.connector} · {s.modalities.map((m) => MODALITY_LABEL[m]).join(", ")}
        {s.size?.rows ? ` · ${s.size.approx ? "up to " : ""}${compact(s.size.rows)} rows` : ""}
      </p>
      <p className="data-source-licence" title={s.licence.plain}>
        <strong>{s.licence.name}</strong>: {s.licence.plain}
      </p>
      <button type="button" className="data-btn" disabled={!ready} title={ready ? undefined : "Images and audio arrive in a coming update."} onClick={onUse}>
        {ready ? "Use this" : "Coming soon"}
      </button>
    </article>
  );
}

/* ---------- A chosen source: name it, pick its part, build ---------- */

function SourceForm({ source }) {
  const data = useData();
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState(source.title);
  const [config, setConfig] = useState("");
  const [split, setSplit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    dataApi
      .getSource(source.id)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        const c = d.configs?.find((x) => x.name === "default") ?? d.configs?.[0];
        if (c) {
          setConfig(c.name);
          setSplit(c.splits.some((s) => s.name === "train") ? "train" : c.splits[0]?.name ?? "");
        }
      })
      .catch((e) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [source.id]);

  const cfg = detail?.configs?.find((c) => c.name === config);
  const chosen = split === "all" ? cfg?.splits ?? [] : cfg?.splits.filter((s) => s.name === split) ?? [];
  const size = chosen.reduce((n, s) => n + (s.bytes ?? 0), 0);
  const rows = chosen.reduce((n, s) => n + (s.rows ?? 0), 0);

  async function build(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await data.createFromSource({ source, name: name.trim(), config, split });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="data-start" onSubmit={build}>
      <button type="button" className="data-link" onClick={data.clearSource}>← Back</button>
      <header className="data-start-head">
        <h1>{source.title}</h1>
        <p>{detail?.description || source.description}</p>
      </header>

      <section className="data-card">
        <dl className="data-facts">
          <dt>From</dt>
          <dd>{source.ref ? `${CONNECTOR_LABEL[source.connector] ?? source.connector} · ${source.ref}` : CONNECTOR_LABEL[source.connector] ?? source.connector}</dd>
          <dt>Licence</dt>
          <dd>
            <strong>{source.licence.name}</strong>: {source.licence.plain}
          </dd>
          <dt>Kind</dt>
          <dd>
            {source.modalities.map((m) => MODALITY_LABEL[m]).join(", ")}
            {source.tasks.length > 0 && ` · ${source.tasks.map((t) => TASK_LABEL[t] ?? t).join(", ")}`}
          </dd>
        </dl>
      </section>

      <section className="data-card">
        <label className="data-field">
          <span>Name your dataset</span>
          <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </label>

        {loadError && <p className="data-error">{loadError}</p>}
        {!detail && !loadError && <p className="data-hint">Looking at what this source holds…</p>}
        {detail && detail.gated && <p className="data-error">This dataset asks you to accept its terms on Hugging Face first. Signing in to Hugging Face from Continuum comes in a later update.</p>}
        {detail && !detail.gated && detail.convertible === false && <p className="data-error">This source has no ready-to-use copy of the data, so it can't be downloaded yet.</p>}
        {detail?.needsCredential && !detail.hasCredential && (
          <p className="data-error">This source needs your {CONNECTOR_LABEL[detail.needsCredential] ?? detail.needsCredential} token. Add it under Library → Settings, then come back.</p>
        )}
        {detail && !detail.configs?.length && !detail.gated && <p className="data-hint">The rows are counted after the download. Archives (zip) are unpacked for you.</p>}

        {detail?.configs?.length > 1 && (
          <label className="data-field">
            <span>Part</span>
            <select
              value={config}
              onChange={(e) => {
                setConfig(e.target.value);
                const c = detail.configs.find((x) => x.name === e.target.value);
                setSplit(c?.splits.some((s) => s.name === "train") ? "train" : c?.splits[0]?.name ?? "");
              }}
            >
              {detail.configs.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        {cfg && (
          <fieldset className="data-field">
            <legend>Which rows</legend>
            <div className="data-chips">
              {cfg.splits.map((s) => (
                <button key={s.name} type="button" className={`data-chip${split === s.name ? " is-on" : ""}`} aria-pressed={split === s.name} onClick={() => setSplit(s.name)}>
                  {s.name} {s.rows ? `· ${compact(s.rows)}` : ""}
                </button>
              ))}
              {cfg.splits.length > 1 && (
                <button type="button" className={`data-chip${split === "all" ? " is-on" : ""}`} aria-pressed={split === "all"} onClick={() => setSplit("all")}>
                  all of them
                </button>
              )}
            </div>
            {cfg.splits.length > 1 && (
              <p className="data-hint">
                "train" is what a model learns from; "test" is kept aside to check it. Taking all of them keeps that split in your dataset.
              </p>
            )}
          </fieldset>
        )}

        {cfg && (
          <p className="data-summary">
            {rows ? `${count(rows)} rows` : "Rows: counted after download"} · {bytes(size)} to download
          </p>
        )}
        {error && <p className="data-error">{error}</p>}
        <div className="data-actions">
          <button type="submit" className="data-btn is-primary" disabled={busy || !detail || detail.gated || detail.convertible === false || (detail.needsCredential && !detail.hasCredential) || !name.trim()}>
            {busy ? "Starting…" : "Build dataset"}
          </button>
        </div>
      </section>
    </form>
  );
}

/* ---------- Your own files ---------- */

function UploadForm() {
  const data = useData();
  const [files, setFiles] = useState([]);
  const [name, setName] = useState("");
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);

  const add = (list) => {
    const picked = [...list].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
    setFiles((f) => [...f, ...picked]);
    if (!name && picked[0]) setName(picked[0].path.split("/")[0].replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  };
  const total = files.reduce((n, f) => n + f.file.size, 0);

  async function upload() {
    setError(null);
    setSent(0);
    try {
      await data.createFromFiles({ name: name.trim(), files, onProgress: (done) => setSent(done) });
    } catch (e) {
      setError(e.message);
      setSent(null);
    }
  }

  return (
    <div className="data-upload">
      <div
        className={`data-drop${over ? " is-over" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <p>Drop files here: spreadsheets (CSV, Excel), JSON, Parquet, text, web pages or PDFs.</p>
        <div className="data-actions">
          <button type="button" className="data-btn" onClick={() => fileInput.current?.click()}>Choose files</button>
          <button type="button" className="data-btn" onClick={() => folderInput.current?.click()}>Choose a folder</button>
        </div>
        <input ref={fileInput} type="file" multiple accept={UPLOAD_TYPES} hidden onChange={(e) => add(e.target.files)} />
        <input ref={folderInput} type="file" multiple webkitdirectory="" hidden onChange={(e) => add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <>
          <p className="data-summary">
            {files.length} {files.length === 1 ? "file" : "files"} · {bytes(total)}{" "}
            <button type="button" className="data-link" onClick={() => setFiles([])}>Clear</button>
          </p>
          <label className="data-field">
            <span>Name your dataset</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          {sent !== null && (
            <div className="data-meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={sent} aria-label="Uploading">
              <span style={{ width: `${total ? (sent / total) * 100 : 0}%` }} />
            </div>
          )}
          {error && <p className="data-error">{error}</p>}
          <div className="data-actions">
            <button type="button" className="data-btn is-primary" disabled={!name.trim() || sent !== null} onClick={upload}>
              {sent !== null ? "Uploading…" : "Upload and build"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- A dataset: its build and its rows ---------- */

function DatasetView({ dataset: d }) {
  const data = useData();
  const versions = data.versions[d.id];
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    data.loadVersions(d.id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id, d.versionCount]);

  const versionId = data.versionPick[d.id] ?? null;
  const setVersionId = (id) => data.pickVersion(d.id, id);
  const version = versions?.find((v) => v.id === versionId) ?? versions?.[0] ?? null;
  const run = d.lastRun;
  const madeOf = (v) => {
    const op = v.madeBy?.op;
    return op && op !== "ingest" ? ` · ${STEP_LABEL[op] ?? op}` : "";
  };

  return (
    <div className="data-dataset">
      <header className="data-ds-head">
        <div className="data-ds-title">
          {renaming ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const name = new FormData(e.currentTarget).get("name");
                await data.rename(d.id, String(name)).catch(() => {});
                setRenaming(false);
              }}
            >
              <input name="name" defaultValue={d.name} autoFocus maxLength={80} onBlur={() => setRenaming(false)} aria-label="Dataset name" />
            </form>
          ) : (
            <h1 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">{d.name}</h1>
          )}
          <span className={`data-state state-${d.state}`}>{STATE_LABEL[d.state] ?? d.state}</span>
        </div>
        <p className="data-ds-meta">
          {d.modality && <span>{MODALITY_ICON[d.modality]} {MODALITY_LABEL[d.modality]}</span>}
          {d.task && <span>{TASK_LABEL[d.task] ?? d.task}</span>}
          {d.rows !== null && <span>{count(d.rows)} rows</span>}
          {d.source && <span title={d.source.licence.plain}>From {d.source.title} · {d.source.licence.name}</span>}
        </p>
        <div className="data-actions">
          {versions?.length > 1 && (
            <select value={version?.id ?? ""} onChange={(e) => setVersionId(e.target.value)} aria-label="Version">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>Version {v.number}{madeOf(v)}{v.frozen ? " · published" : ""}</option>
              ))}
            </select>
          )}
          {confirmDelete ? (
            <>
              <span className="data-hint">Remove this dataset and its files?</span>
              <button type="button" className="data-btn is-danger" onClick={() => data.remove(d.id)}>Remove</button>
              <button type="button" className="data-btn" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            d.state !== "building" && (
              <button type="button" className="data-btn" onClick={() => setConfirmDelete(true)}>Remove…</button>
            )
          )}
        </div>
      </header>

      {run && (run.state !== "succeeded" || !version || run.kind === "pipeline") && <BuildSteps key={run.id} dataset={d} run={run} />}
      {version && d.state !== "building" && <DataPipeline dataset={d} version={version} />}
      {version && <RowTable key={version.id} version={version} />}
    </div>
  );
}

function BuildSteps({ dataset, run }) {
  const data = useData();
  const live = data.progress[run.id];
  const active = !["succeeded", "failed", "cancelled"].includes(run.state);
  return (
    <section className="data-card">
      <div className="data-card-head">
        <h2 className="data-card-title">{run.kind === "pipeline" ? (active ? "Cleaning up" : run.state === "succeeded" ? "Last clean-up" : "Clean-up") : "Building"}</h2>
        {active && !run.cancelRequested && (
          <button type="button" className="data-btn" onClick={() => data.cancel(run.id)}>Cancel</button>
        )}
        {run.state === "failed" && (
          <button type="button" className="data-btn is-primary" onClick={() => data.retry(dataset)}>Try again</button>
        )}
      </div>
      <ol className="data-steps">
        {run.steps.map((s, i) => {
          const p = live?.stepIndex === i && s.state === "running" ? live : s.progress;
          const pct = p?.total ? Math.min(100, (p.done / p.total) * 100) : null;
          return (
            <li key={i} className={`data-step step-${s.state}`}>
              <span className="data-step-mark" aria-hidden="true">{s.state === "succeeded" ? "✓" : s.state === "failed" ? "!" : i + 1}</span>
              <div className="data-step-body">
                <div className="data-step-top">
                  <strong>{STEP_LABEL[s.op] ?? s.op}</strong>
                  <span className="data-step-state">{s.state === "pending" ? "Waiting" : s.state === "running" ? "Working…" : s.state === "succeeded" ? "Done" : s.state === "failed" ? "Stopped" : "Cancelled"}</span>
                </div>
                <p className="data-hint">{s.error?.message ?? (s.state === "succeeded" && s.result ? resultLine(s) : STEP_HINT[s.op] ?? "")}</p>
                {s.state === "succeeded" && s.result?.notes?.length > 0 && (
                  <ul className="data-notes">
                    {s.result.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                {s.state === "succeeded" && s.outputVersionId && s.result?.removed > 0 && <ChangesSample versionId={s.outputVersionId} />}
                {s.state === "running" && (
                  <div className={`data-meter${pct === null ? " is-unknown" : ""}`} role="progressbar" aria-label={STEP_LABEL[s.op]} aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                    <span style={pct === null ? undefined : { width: `${pct}%` }} />
                  </div>
                )}
                {s.state === "running" && p?.total ? (
                  <p className="data-hint">{p.unit === "bytes" ? `${bytes(p.done)} of ${bytes(p.total)}` : `${count(p.done)} of ${count(p.total)} ${p.unit ?? ""}`}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {run.state === "failed" && run.error && <p className="data-error">{run.error.message}</p>}
    </section>
  );
}

/** One line for a finished step: what it did, in numbers. */
function resultLine(s) {
  const r = s.result;
  if (s.op === "validate") return `Quality score ${r.score}: ${r.verdict} (${r.passed} of ${r.total} checks passed).`;
  if (s.op === "profile") return `Measured ${count(r.rows)} rows.`;
  if (s.op === "fetch") return `Downloaded ${bytes(r.bytes)}.`;
  if (s.op === "ingest") return `${count(r.rows)} rows in one table.`;
  if (s.op === "split" && r.splits) return Object.entries(r.splits).map(([k, n]) => `${k} ${count(n)}`).join(" · ");
  if (r.removed) return `Removed ${count(r.removed)} rows; ${count(r.rows)} left.`;
  if (r.changed) return `Changed ${count(r.changed)} cells or rows.`;
  return "Nothing needed changing.";
}

/** A sample of what a step removed or changed, and why. */
function ChangesSample({ versionId }) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState(null);
  useEffect(() => {
    if (!open || changes) return;
    dataApi.changes(versionId).then(setChanges).catch(() => setChanges({ sample: [] }));
  }, [open, changes, versionId]);
  return (
    <div className="data-changes">
      <button type="button" className="data-link" onClick={() => setOpen((o) => !o)}>{open ? "Hide examples" : "See examples"}</button>
      {open && changes && (
        changes.sample?.length ? (
          <ul>
            {changes.sample.slice(0, 12).map((x, i) => (
              <li key={x._id ?? i}>
                <span className="data-tag">{x.reason}</span> {cellText(x.row.text ?? x.row.messages ?? Object.values(x.row).filter((v) => typeof v !== "object").join(" · ")).slice(0, 220)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="data-hint">No examples to show for this step.</p>
        )
      )}
    </div>
  );
}

const PAGE = 50;

function RowTable({ version }) {
  const [page, setPage] = useState(0);
  const [split, setSplit] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showMeta, setShowMeta] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let live = true;
    dataApi
      .rows(version.id, page * PAGE, PAGE, split)
      .then((r) => live && (setResult(r), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [version.id, page, split]);

  const columns = version.schema.filter((c) => showMeta || !c.name.startsWith("_") || (c.name === "_split" && version.splits));
  const total = result?.total ?? (split ? version.splits?.[split] : version.rows) ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <section className="data-card data-rows">
      <div className="data-card-head">
        <h2 className="data-card-title">
          Rows <span className="bridge-count">{compact(total)}</span>
        </h2>
        <div className="data-actions">
          {version.splits && Object.keys(version.splits).length > 1 && (
            <div className="data-chips" role="group" aria-label="Which rows">
              {[null, ...Object.keys(version.splits)].map((k) => (
                <button key={k ?? "all"} type="button" className={`data-chip${split === k ? " is-on" : ""}`} aria-pressed={split === k} onClick={() => (setSplit(k), setPage(0))}>
                  {k ?? "all"} {k ? `· ${compact(version.splits[k])}` : ""}
                </button>
              ))}
            </div>
          )}
          <label className="data-toggle">
            <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} /> Show where each row came from
          </label>
        </div>
      </div>
      {error && <p className="data-error">{error}</p>}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-rownum">#</th>
              {columns.map((c) => (
                <th key={c.name} title={`${c.type}${c.role === "label" ? " · label" : ""}`} className={c.role === "label" ? "is-label" : undefined}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((row, i) => (
              <tr key={row._id ?? i} onClick={() => setOpen(row)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(row)}>
                <td className="data-rownum">{count(page * PAGE + i + 1)}</td>
                {columns.map((c) => (
                  <td key={c.name} className={c.role === "label" ? "is-label" : undefined}>
                    <span className="data-cell">{cellText(row[c.name])}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-pager">
        <button type="button" className="data-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</button>
        <span>Page {count(page + 1)} of {count(pages)}</span>
        <button type="button" className="data-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </div>
      {open && <RowDetail row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function RowDetail({ row, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="data-detail" role="dialog" aria-label="Row">
      <div className="data-card-head">
        <h2 className="data-card-title">Row</h2>
        <button type="button" className="data-btn" onClick={onClose}>Close</button>
      </div>
      <dl className="data-facts">
        {Object.entries(row).map(([k, v]) => (
          <div key={k} className="data-fact">
            <dt>{k}</dt>
            <dd>
              {Array.isArray(v) && v.every((m) => m && typeof m === "object" && "role" in m) ? (
                <ul className="data-chat">
                  {v.map((m, i) => (
                    <li key={i} className={`role-${m.role}`}>
                      <strong>{m.role}</strong> {m.content}
                    </li>
                  ))}
                </ul>
              ) : (
                <pre>{cellText(v)}</pre>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
