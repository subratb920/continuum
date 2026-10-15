// src/utils/time.js
import { getPreferences } from "./preferences";

/** Settings → General → Clock: 12 h, 24 h, or the device's own (auto). */
function hour12() {
  const c = getPreferences().clock;
  return c === "12" ? true : c === "24" ? false : undefined;
}

export function formatDateTime(date) {
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: hour12(),
  }).format(new Date(date));
}

/** A time of day, e.g. 14:05 or 2:05 PM (per Settings → General → Clock). */
export function formatTimeOfDay(date) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: hour12() });
}

// Elapsed time: m:ss under an hour, h:mm:ss from one hour
// (e.g. 0:42, 29:57, 3:59:44). Used by the timer and bridge history.
export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

// Planned interval length in minutes → "30 min", "1 h 30 min", "4 h"
export function formatDuration(totalMinutes) {
  const minutes = Number(totalMinutes) || 0;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}