import { useEffect, useState } from "react";
import { dataApi } from "../../data/dataApi";
import { count, seconds } from "./dataDisplay";
import "./data.css";

/**
 * Pictures and sound in the Workbench: a grid of pictures with their labels,
 * or a list of clips with a player (loaded when asked, so a page doesn't
 * download every clip). Files come through the API with the sign-in, so each
 * is fetched and shown from a local address.
 */
function useMediaUrl(versionId, path, enabled = true) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || !path) return undefined;
    let live = true;
    let made = null;
    dataApi
      .mediaUrl(versionId, path)
      .then((u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [versionId, path, enabled]);
  return { url, failed };
}

function Thumb({ versionId, row, onOpen }) {
  const { url, failed } = useMediaUrl(versionId, row.image);
  return (
    <li>
      <button type="button" className="data-thumb" onClick={() => onOpen(row)} title={`${row.label ?? ""} · ${row.width} × ${row.height}`}>
        {url ? <img src={url} alt={row.label ? `A picture labelled ${row.label}` : "A picture"} loading="lazy" /> : <span className="data-thumb-wait">{failed ? "!" : ""}</span>}
        <span className="data-thumb-label">{row.label ?? "—"}</span>
        {row._flags?.includes("augmented") && <span className="data-tag">made</span>}
      </button>
    </li>
  );
}

export function ImageGrid({ versionId, rows, onOpen }) {
  return (
    <ul className="data-grid" aria-label="Pictures">
      {rows.map((r, i) => (
        <Thumb key={`${r._id}-${i}`} versionId={versionId} row={r} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function Clip({ versionId, row, n }) {
  const [load, setLoad] = useState(false);
  const { url, failed } = useMediaUrl(versionId, row.audio, load);
  return (
    <li className="data-clip">
      <span className="data-rownum">{count(n)}</span>
      <div className="data-clip-main">
        {url ? (
          <audio controls autoPlay src={url} aria-label={row.text ? `Clip: ${row.text}` : "Sound clip"} />
        ) : (
          <button type="button" className="data-btn" onClick={() => setLoad(true)} disabled={load && !failed}>
            {failed ? "Couldn't load" : load ? "Loading…" : "▶ Play"}
          </button>
        )}
        <span className="data-clip-text">{row.text ?? row.label ?? <em>no transcript</em>}</span>
      </div>
      <span className="data-hint">
        {seconds(row.duration)} · {count(row.sample_rate)} Hz{row.channels > 1 ? ` · ${row.channels} channels` : ""}
        {row._split ? ` · ${row._split}` : ""}
      </span>
    </li>
  );
}

export function AudioList({ versionId, rows, offset }) {
  return (
    <ol className="data-clips" aria-label="Sound clips">
      {rows.map((r, i) => (
        <Clip key={`${r._id}-${i}`} versionId={versionId} row={r} n={offset + i + 1} />
      ))}
    </ol>
  );
}

/** The open picture, larger, with its details. */
export function ImageDetail({ versionId, row }) {
  const { url } = useMediaUrl(versionId, row.image);
  return url ? <img className="data-detail-img" src={url} alt={row.label ? `A picture labelled ${row.label}` : "A picture"} /> : null;
}
