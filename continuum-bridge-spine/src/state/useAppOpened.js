import { useEffect } from "react";
import { useAuth } from "./authStore";

/** Where each app opens: its page or screen → its feature (access/features). */
const APP_OF_PATH = {
  "/console": "interval",
  "/brain": "agents",
  "/data": "data",
  "/dashboard": "dashboard",
  "/workspaces": "workspaces",
  "/new": "create",
  "/import": "import_github",
};
const EVERY_MS = 60_000;
const lastSent = new Map(); // app → when this tab last said so

/**
 * Says which app you opened (for the admin's view of which apps people use),
 * at most once a minute per app; only apps your role has.
 */
export function useAppOpened(pathname) {
  const { status, can } = useAuth();
  const app = APP_OF_PATH[pathname];
  const allowed = !!app && can(app);
  useEffect(() => {
    if (status !== "authenticated" || !allowed) return;
    const now = Date.now();
    if (now - (lastSent.get(app) ?? 0) < EVERY_MS) return;
    lastSent.set(app, now);
    const token = localStorage.getItem("continuum_token");
    fetch(`${import.meta.env.VITE_API_BASE_URL}/me/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ app }),
    }).catch(() => {});
  }, [status, app, allowed]);
}
