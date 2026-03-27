export function normalizeBridge(raw) {
  return {
    _id: String(raw._id),
    projectId: String(raw.projectId),

    name: raw.name ?? `bridge-${raw.index ?? "?"}`,
    index: raw.index ?? 0,

    interval: {
      mode: raw.interval?.mode ?? "execution",
      duration: raw.interval?.duration ?? 0,
      startedAt: raw.interval?.startedAt ?? null,
      endedAt: raw.interval?.endedAt ?? null,
    },

    sessionGoals: Array.isArray(raw.sessionGoals)
      ? raw.sessionGoals.map((g, i) => ({
          id: String(g.id ?? `g${i + 1}`),
          text: typeof g.text === "string" ? g.text : "",
          status: g.status ?? "untouched",
        }))
      : [],

    status: raw.status ?? "draft",
    ticketUrl: raw.ticketUrl ?? null, 

    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? null,
  };
}
