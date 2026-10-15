import { useState } from "react";
import { createProject } from "../api";

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

  async function handleCreate() {
    if (!name.trim() || creating) return;

    setError("");
    setCreating(true);

    try {
      const project = await createProject(name.trim(), contents ? { source: "device", contents } : {});
      onCreated(project);
    } catch (err) {
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

      <p style={{ color: "#666", marginBottom: importedFrom ? 8 : 24 }}>
        Add A Project To Run In Continuity.
      </p>

      {importedFrom && (
        <p style={{ color: "#555", fontSize: 13, marginBottom: 24 }}>
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

      {error && (
        <p style={{ color: "#d33", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
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
            style={{
              padding: "8px 16px",
              fontSize: 14,
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
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
