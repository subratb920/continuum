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
    bridgeCount: raw.bridgeCount ?? 0,
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
