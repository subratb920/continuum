export function assertProject(project) {
  if (!project._id || !project.name) {
    console.error("Invalid project detected:", project);
    throw new Error("Invalid Project shape in state");
  }
}
