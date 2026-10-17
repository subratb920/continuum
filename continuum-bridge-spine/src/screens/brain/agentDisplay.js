import { useEffect, useState } from "react";

/** "Core", or "Worker 2" (by the order the workers started). */
export function agentName(agent, workers) {
  if (!agent) return "";
  if (agent.kind === "core") return "Core";
  return `Worker ${workers.findIndex((w) => w._id === agent._id) + 1}`;
}

/** Short mark inside the agent's node. */
export function agentGlyph(agent, workers) {
  return agent.kind === "core" ? "✦" : `W${workers.findIndex((w) => w._id === agent._id) + 1}`;
}

/** 4s, 3m 12s, 1h 05m */
export function elapsed(from, to = Date.now()) {
  if (!from) return "";
  const s = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** just now, 5 min ago, 2 h ago, 3 d ago */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(at)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function clock(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The time now, every second (for running clocks). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const KIND_ICON = {
  user: "↳",
  state: "•",
  text: "💬",
  tool: "⚙",
  permission: "🔐",
  question: "❓",
  error: "⚠",
};
