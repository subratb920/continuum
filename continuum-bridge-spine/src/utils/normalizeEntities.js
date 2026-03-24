export function normalizeEntities({
  projects = [],
  bridges = [],
}) {
  const normalizedProjects = projects.map(normalizeProject);

  const projectMap = new Map(
    normalizedProjects.map(p => [p._id, p])
  );

  const normalizedBridges = bridges.map(b => {
    const bridge = normalizeBridge(b);

    const project = projectMap.get(bridge.projectId);
    if (project) {
      bridge.projectName = project.name;
    }

    return bridge;
  });

  return {
    projects: normalizedProjects,
    bridges: normalizedBridges,
  };
}
