export function normalizeBridge(raw) {
  return {
    _id: String(raw._id),
    projectId: String(raw.projectId),

    name: raw.name ?? `bridge-${raw.index ?? "?"}`,
    index: raw.index ?? 0,

    interval: {
      // human: a person's, timed (every bridge from before); agent: Continuum Brain works its goals
      kind: raw.interval?.kind === "agent" ? "agent" : "human",
      endedBy: raw.interval?.endedBy ?? null,
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
          // The agents that worked on it (recorded when the interval stops or is saved)
          ...(Array.isArray(g.agents) && g.agents.length ? { agents: g.agents } : {}),
          // Agent intervals: the brain's tasks for the goal, and its verdict after reviewing the work
          ...(Array.isArray(g.tasks) && g.tasks.length ? { tasks: g.tasks.map((t) => ({ id: String(t.id), text: t.text ?? "", agentId: t.agentId ?? null, state: t.state ?? "planned", note: t.note ?? null })) } : {}),
          ...(g.verification ? { verification: { verdict: g.verification.verdict, note: g.verification.note ?? null, at: g.verification.at ?? null } } : {}),
        }))
      : [],

    status: raw.status ?? "draft",
    ticketUrl: raw.ticketUrl ?? null, 

    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? null,
  };
}
