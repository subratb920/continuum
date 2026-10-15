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

function Folder({ node, depth, startOpen }) {
  const [open, setOpen] = useState(startOpen);
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <li>
      <button type="button" className="pc-folder" style={{ "--depth": depth }} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${node.count} files · ${formatBytes(node.bytes)}`}>
        <span className="pc-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="pc-name">{node.name}</span>
        <span className="pc-size">{node.count}</span>
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
        <li key={f.name} className="pc-file" style={{ "--depth": depth }} title={`${f.name} · ${formatBytes(f.size)}`}>
          <span className="pc-caret" aria-hidden="true" />
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
      <p className="pc-summary">
        {d.fileCount} file{d.fileCount === 1 ? "" : "s"} · {formatBytes(d.totalBytes)}
        {when && ` · imported ${when}`}
        {d.folder && ` from ${d.folder}`}
      </p>
      {d.truncated && <p className="pc-note">Only the first {d.fileCount} files were kept.</p>}
      {tree.count === 0 ? <p className="pc-note">No files (dependencies, build output and .env files are left out).</p> : <Children folders={[...tree.folders.values()].sort((a, b) => a.name.localeCompare(b.name))} files={tree.files} depth={0} />}
    </div>
  );
}
