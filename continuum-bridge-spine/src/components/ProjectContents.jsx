import { useEffect, useMemo, useState } from "react";
import { fetchProjectContents } from "../api";
import { formatBytes } from "../utils/importFromDevice";

/** Files already loaded, per project and import (they don't change until the folder is imported again). */
const loaded = new Map();

/** entries [[path, size]] → a tree of folders and files, each folder with its file count and size. */
function treeOf(entries) {
  const root = { name: "", folders: new Map(), files: [], count: 0, bytes: 0 };
  for (const [path, size] of entries) {
    const parts = path.split("/");
    let node = root;
    node.count++;
    node.bytes += size;
    for (const dir of parts.slice(0, -1)) {
      if (!node.folders.has(dir)) node.folders.set(dir, { name: dir, folders: new Map(), files: [], count: 0, bytes: 0 });
      node = node.folders.get(dir);
      node.count++;
      node.bytes += size;
    }
    node.files.push({ name: parts.at(-1), size });
  }
  return root;
}

function FolderIcon({ open }) {
  return (
    <svg className="pc-icon pc-icon-folder" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {open ? <path d="M1.5 4.5V12a1 1 0 001 1h10.2a1 1 0 00.97-.76l1.2-4.8A.8.8 0 0014.1 6.5H4.6a1 1 0 00-.97.76L2.4 12M1.5 4.5V3.5a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /> : <path d="M1.5 3.5a1 1 0 011-1h3.3l1.5 1.5h6.2a1 1 0 011 1v7.5a1 1 0 01-1 1H2.5a1 1 0 01-1-1z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="pc-icon pc-icon-file" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 1.5h5l3.5 3.5v8.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z M9 1.5V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function Folder({ node, depth, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <li>
      <button type="button" className="pc-row pc-folder" style={{ "--depth": depth }} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${node.name}/`}>
        <span className="pc-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <FolderIcon open={open} />
        <span className="pc-name">{node.name}</span>
      </button>
      {open && <Children folders={folders} files={files} depth={depth + 1} />}
    </li>
  );
}

function Children({ folders, files, depth }) {
  return (
    <ul className="pc-list">
      {folders.map((f) => (
        <Folder key={f.name} node={f} depth={depth} startOpen={false} />
      ))}
      {files.map((f) => (
        <li key={f.name} className="pc-row pc-file" style={{ "--depth": depth }} title={`${f.name} · ${formatBytes(f.size)}`}>
          <span className="pc-caret" aria-hidden="true" />
          <FileIcon />
          <span className="pc-name">{f.name}</span>
          <span className="pc-size">{formatBytes(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The contents of a project imported from a device: its folders and files
 * (names and sizes only, saved when it was imported), as a tree.
 */
export default function ProjectContents({ project }) {
  const key = `${project._id}:${project.contents?.importedAt ?? ""}`;
  const [state, setState] = useState(() => (loaded.has(key) ? { data: loaded.get(key) } : { loading: true }));

  useEffect(() => {
    if (loaded.has(key)) return;
    let stale = false;
    fetchProjectContents(project._id)
      .then((data) => {
        loaded.set(key, data);
        if (!stale) setState({ data });
      })
      .catch((err) => !stale && setState({ error: err.message || "The contents couldn't be loaded." }));
    return () => {
      stale = true;
    };
  }, [key, project._id]);

  const tree = useMemo(() => (state.data ? treeOf(state.data.entries ?? []) : null), [state.data]);

  if (state.loading) return <p className="pc-note">Loading contents…</p>;
  if (state.error) return <p className="pc-note pc-error">{state.error}</p>;

  const d = state.data;
  const when = d.importedAt ? new Date(d.importedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <div className="pc">
      {(when || d.folder) && (
        <p className="pc-summary">
          {d.folder ? `Folder ${d.folder} on your device` : "On your device"}
          {when && ` · ${when}`}
        </p>
      )}
      {d.truncated && <p className="pc-note">The folder was too large: only part of it is listed.</p>}
      {tree.count === 0 ? <p className="pc-note">No files yet.</p> : <Children folders={[...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name))} files={tree.files} depth={0} />}
    </div>
  );
}
