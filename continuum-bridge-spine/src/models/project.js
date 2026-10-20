/**
 * Canonical Project model
 * Every project used in UI MUST conform to this shape
 */
export function normalizeProject(raw) {
  if (!raw) {
    throw new Error("normalizeProject: received null/undefined");
  }

  const project = {
    _id: raw._id ?? raw.projectId,
    name: raw.name,
    source: raw.source ?? "local",
    githubRepoId: raw.githubRepoId ?? null,
    githubRepoUrl: raw.githubRepoUrl ?? null,
    visibility: raw.visibility ?? "local",
    fullName: raw.fullName ?? null,

    // Imported from a device: { folder, fileCount, totalBytes, truncated, importedAt } (files load separately)
    contents: raw.contents ?? null,

    // existing
    bridgeCount: raw.bridgeCount ?? 0,

    // Who added it, and (an organization's project) which space and departments see it (none: every member)
    userId: raw.userId ? String(raw.userId) : null,
    spaceId: raw.spaceId ?? null,
    departmentIds: (raw.departmentIds ?? []).map(String),
  };

  // 🚨 Fail fast if contract is violated
  if (!project._id) {
    throw new Error("Project missing _id");
  }

  if (!project.name) {
    throw new Error("Project missing name");
  }

  return project;
}

export function getProjectMeta(project) {
  if (project.source === "github") {
    return {
      icon: project.visibility === "private" ? "🔒" : "🔓",
      label: project.visibility,
    };
  }

  if (project.source === "device") {
    return {
      icon: "💻",
      label: "device",
    };
  }

  return {
    icon: "📁",
    label: "local",
  };
}