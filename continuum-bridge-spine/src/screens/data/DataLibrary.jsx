import { useState } from "react";
import { useSourceSearch } from "./useSourceSearch";
import { useData } from "../../data/dataContext";
import { compact, CONNECTOR_LABEL, MODALITY_ICON, MODALITY_LABEL, STATE_LABEL, READY_MODALITIES } from "./dataDisplay";
import { dataApi } from "../../data/dataApi";
import DataSettings from "./DataSettings";
import "./data.css";

/**
 * Library (left): your datasets, and the sources to make new ones from. The
 * source list is the shared catalogue; a search also asks Hugging Face, and
 * what it finds joins the catalogue for everyone.
 */
export default function DataLibrary() {
  const data = useData();
  const [tab, setTab] = useState("datasets");
  if (!data) return null;
  return (
    <div className="data-library">
      <div className="data-tabs" role="tablist" aria-label="Library">
        <button type="button" role="tab" aria-selected={tab === "datasets"} className={tab === "datasets" ? "is-on" : ""} onClick={() => setTab("datasets")}>
          Datasets <span className="bridge-count">{data.datasets.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "sources"} className={tab === "sources" ? "is-on" : ""} onClick={() => setTab("sources")}>
          Sources
        </button>
        <button type="button" role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "is-on" : ""} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>
      {tab === "datasets" ? <DatasetList /> : tab === "sources" ? <SourceList onChosen={() => setTab("datasets")} /> : <DataSettings />}
    </div>
  );
}

function DatasetList() {
  const { datasets, loaded, error, selectedId, select } = useData();
  return (
    <>
      <button type="button" className="data-btn is-primary data-new" onClick={() => select(null)}>
        + New dataset
      </button>
      {error && <p className="data-error">{error}</p>}
      {loaded && !datasets.length && <p className="data-hint">No datasets yet. Start one from a source or your own files.</p>}
      <ul className="data-list">
        {datasets.map((d) => (
          <li key={d.id}>
            <button type="button" className={`data-row state-${d.state}${selectedId === d.id ? " selected" : ""}`} onClick={() => select(d.id)}>
              <span className="data-dot" aria-hidden="true" />
              <span className="data-row-main">
                <span className="data-row-top">
                  <span className="data-row-name">{d.name}</span>
                  <span className="data-row-state">{STATE_LABEL[d.state] ?? d.state}</span>
                </span>
                <span className="data-row-sub">
                  {d.modality ? `${MODALITY_ICON[d.modality]} ${MODALITY_LABEL[d.modality]}` : "…"}
                  {d.rows !== null && ` · ${compact(d.rows)} rows`}
                  {d.versionCount > 0 && ` · v${d.versionCount}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "text", label: "Text" },
  { id: "tabular", label: "Tables" },
  { id: "image", label: "Images" },
  { id: "audio", label: "Audio" },
];

export function SourceSearchBox({ search, autoFocus }) {
  return (
    <div className="data-search">
      <input
        type="search"
        autoFocus={autoFocus}
        value={search.text}
        placeholder="Search: reviews, spam, flowers, maths…"
        aria-label="Search for data"
        onChange={(e) => search.setText(e.target.value)}
      />
      <div className="data-chips" role="group" aria-label="Kind of data">
        {FILTERS.map((f) => (
          <button key={f.id || "all"} type="button" className={`data-chip${search.modality === f.id ? " is-on" : ""}`} aria-pressed={search.modality === f.id} onClick={() => search.setModality(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Paste a link: a Kaggle, Hugging Face, OpenML or UCI page, or any file or zip on the web. */
export function AddLink({ onAdded }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const source = await dataApi.addSource(link);
      setLink("");
      onAdded(source);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="data-addlink" onSubmit={add}>
      <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link: Kaggle, Hugging Face, OpenML, UCI or a file" aria-label="Link to data" />
      <button type="submit" className="data-btn" disabled={busy || !link.trim()}>{busy ? "Adding…" : "Add"}</button>
      {error && <p className="data-error">{error}</p>}
    </form>
  );
}

function SourceList({ onChosen }) {
  const data = useData();
  const search = useSourceSearch();
  return (
    <>
      <AddLink onAdded={(s) => (data.chooseSource(s), onChosen?.())} />
      <SourceSearchBox search={search} />
      {search.error && <p className="data-error">{search.error}</p>}
      {search.liveError && <p className="data-hint">{search.liveError} Showing what Continuum already knows.</p>}
      {!search.loading && !search.sources.length && <p className="data-hint">Nothing found. Try other words.</p>}
      <ul className="data-list">
        {search.sources.map((s) => {
          const ready = s.modalities.some((m) => READY_MODALITIES.includes(m));
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`data-row is-source${data.pendingSource?.id === s.id ? " selected" : ""}`}
                onClick={() => {
                  data.chooseSource(s);
                  onChosen?.();
                }}
              >
                <span className="data-row-icon" aria-hidden="true">{MODALITY_ICON[s.modalities[0]] ?? "?"}</span>
                <span className="data-row-main">
                  <span className="data-row-top">
                    <span className="data-row-name">{s.title}</span>
                    {!ready && <span className="data-row-state">Soon</span>}
                  </span>
                  <span className="data-row-sub">
                    {CONNECTOR_LABEL[s.connector] ?? s.connector} · {s.licence.name}
                    {s.size?.rows ? ` · ${s.size.approx ? "up to " : ""}${compact(s.size.rows)} rows` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
