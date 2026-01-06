import { useState } from "react";
import { createProject } from "../api";

export default function CreateProject({ onCreated }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;

    setCreating(true);
    const project = await createProject(name.trim());
    onCreated(project);
  }

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "120px auto",
        textAlign: "center",
      }}
    >
      <h2>Continuum Console</h2>
      <p>No projects exist yet.</p>

      <input
        autoFocus
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginTop: 24,
          marginBottom: 16,
        }}
      />

      <button
        onClick={handleCreate}
        disabled={creating}
        style={{ padding: "8px 16px" }}
      >
        Create Project
      </button>
    </div>
  );
}
