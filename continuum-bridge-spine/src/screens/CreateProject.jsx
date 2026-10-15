import { useState } from "react";
import { createProject } from "../api";
import "./CreateProject.css";
import DeviceFolderOption from "../components/DeviceFolderOption";
import { getPreferences } from "../utils/preferences";
import { createProjectFolder, pickParentFolder, removeProjectFolder } from "../utils/deviceFolder";

/**
 * CreateProjectScreen
 * -------------------
 * Create-project form rendered inside the Create Project modal.
 * (First-time users see screens/Welcome.jsx instead.)
 */
export default function CreateProject({ onCreated, onClose, initialName = "", importedFrom = null, contents = null }) {
  const [name, setName] = useState(initialName);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Off unless ticked; not offered for a folder imported from the device (it already exists)
  const [makeFolder, setMakeFolder] = useState(() => getPreferences().folderOptionDefault);

  async function handleCreate() {
    if (!name.trim() || creating) return;

    setError("");

    // The folder first: the browser only opens its picker straight after a click
    let parent = null;
    let folder = null;
    if (makeFolder && !contents) {
      try {
        parent = await pickParentFolder();
      } catch (err) {
        setError(`The folder couldn't be created: ${err.message}`);
        return;
      }
      if (!parent) {
        setError("Choose where the project folder goes, or untick “Create a folder on this device”.");
        return;
      }
    }

    setCreating(true);
    try {
      if (parent) folder = await createProjectFolder(parent, name.trim());
      const extra = contents ? { source: "device", contents } : folder ? { source: "device", contents: { folder: folder.name, entries: [] } } : {};
      const project = await createProject(name.trim(), extra);
      onCreated(project);
    } catch (err) {
      if (parent && folder) await removeProjectFolder(parent, folder.name);
      setError(err.message || "Could not create the project. Please try again.");
      setCreating(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "120px auto",
        padding: "0 16px",
        textAlign: "center",
      }}
    >
      <h2 style={{ marginBottom: 8 }}>
        Continuum Console
      </h2>

      <p className="cp-sub" style={{ marginBottom: importedFrom ? 8 : 24 }}>
        Add A Project To Run In Continuity.
      </p>

      {importedFrom && (
        <p className="cp-note" style={{ fontSize: 13, marginBottom: 24 }}>
          From your device ({importedFrom}){contents ? ` · ${contents.entries.length}${contents.truncated ? "+" : ""} files listed` : ""}. Only the names of its files are kept; nothing is uploaded.
        </p>
      )}

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 16,
          fontSize: 14,
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
        }}
      />

      {!contents && (
        <DeviceFolderOption
          checked={makeFolder}
          onChange={setMakeFolder}
          disabled={creating}
          hint="You choose where; an empty folder named after the project is made there."
        />
      )}

      {error && (
        <p className="cp-error" style={{ fontSize: 13, marginTop: -8, marginBottom: 16 }}>
          {error}
        </p>
      )}

      {/* 🔑 Action buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="cp-close"
            style={{
              padding: "8px 16px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        )}

        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          style={{
            padding: "8px 16px",
            fontSize: 14,
            cursor: creating ? "not-allowed" : "pointer",
          }}
        >
          {creating ? "Creating…" : "Create Project"}
        </button>
      </div>
    </div>
  );
}
