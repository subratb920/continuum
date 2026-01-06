import { useState } from "react";
import { createProject } from "../api";

export default function CreateProject({ onCreated }) {
  const [name, setName] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;

    const project = await createProject(name);
    onCreated(project);
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto" }}>
      <h2>Continuum Console</h2>
      <p>No projects exist yet.</p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        style={{ width: "100%", padding: 8, marginBottom: 16 }}
      />

      <button onClick={handleCreate}>
        Create Project
      </button>
    </div>
  );
}
