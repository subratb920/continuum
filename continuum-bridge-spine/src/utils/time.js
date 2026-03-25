// src/utils/time.js
export function formatDateTime(date) {
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(date));
}