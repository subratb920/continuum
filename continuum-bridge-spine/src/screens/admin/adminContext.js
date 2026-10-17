import { createContext, useContext } from "react";

/** The admin area's state and actions (AdminProvider fills it). */
export const AdminContext = createContext(null);

export function useAdmin() {
  return useContext(AdminContext);
}

/** The admin area's sections (left pane). */
export const ADMIN_SECTIONS = [
  ["users", "Users", "👥"],
  ["roles", "Roles", "🛡"],
  ["signins", "Sign-ins", "🔑"],
  ["changes", "Admin changes", "📝"],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday", "3 weeks ago"; "never" for none. */
export function since(at) {
  if (!at) return "never";
  const s = (Date.parse(at) - Date.now()) / 1000;
  for (const [unit, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
  }
  return "just now";
}

/** "Safari 17.4 · iOS 17.4 · phone" (whatever is known). */
export function deviceText(d) {
  if (!d) return "";
  return [d.browser, d.os, d.device].filter(Boolean).join(" · ");
}
