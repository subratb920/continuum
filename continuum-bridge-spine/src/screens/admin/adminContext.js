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

/** "IPv4 · Wi-Fi, 4g, 10 Mbit/s · 38 ms · TLSv1.3" (whatever is known about the network; the proxies' chain is a tooltip). */
export function networkText(d) {
  if (!d) return "";
  const n = d.network ?? {};
  const c = d.client ?? {};
  const connection = [c.netType && ({ wifi: "Wi-Fi", cellular: "mobile data", ethernet: "wired" }[c.netType] ?? c.netType), c.netEffective, c.netDownlinkMbps !== undefined && `${c.netDownlinkMbps} Mbit/s`, c.netSaveData && "data saver"].filter(Boolean).join(", ");
  const rtt = n.rttMs ?? c.netRttMs;
  return [
    n.ipVersion && `IPv${n.ipVersion}`,
    connection,
    rtt !== undefined && rtt !== null && `${rtt} ms`,
    n.tlsVersion,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Bengaluru, INKA, IN" (the load balancer's view; the city's position, never the device's). */
export function placeText(d) {
  if (!d) return "";
  return [d.city, d.network?.subdivision, d.region].filter(Boolean).join(", ");
}
