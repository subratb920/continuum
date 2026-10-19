import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "continuum_token";

const AuthContext = createContext(null);

/**
 * What this browser is, sent once after a sign-in (added to that sign-in, for
 * the admin's view): platform, screen, time zone, language, touch, memory,
 * cores, and its network (connection type, speed, round-trip time, data saver).
 */
function sendDeviceDetails(token) {
  const n = navigator;
  const body = {
    platform: n.userAgentData?.platform || n.platform || "",
    screen: `${screen.width}×${screen.height}@${window.devicePixelRatio || 1}x`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    language: n.language || "",
    touch: (n.maxTouchPoints ?? 0) > 0,
    ...(n.deviceMemory ? { memory: n.deviceMemory } : {}),
    ...(n.hardwareConcurrency ? { cores: n.hardwareConcurrency } : {}),
    // The network, as the browser sees it (Chrome, Edge and Android; others don't say)
    ...(n.connection?.type ? { netType: n.connection.type } : {}),
    ...(n.connection?.effectiveType ? { netEffective: n.connection.effectiveType } : {}),
    ...(Number.isFinite(n.connection?.downlink) ? { netDownlinkMbps: n.connection.downlink } : {}),
    ...(Number.isFinite(n.connection?.rtt) ? { netRttMs: n.connection.rtt } : {}),
    ...(typeof n.connection?.saveData === "boolean" ? { netSaveData: n.connection.saveData } : {}),
  };
  fetch(`${import.meta.env.VITE_API_BASE_URL}/me/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); // checking | authenticated | unauthenticated
  const [user, setUser] = useState(null);
  const [authProvider, setAuthProvider] = useState("local");
  // Your access (GET /me): your role and the features it has switched on; null until known
  const [access, setAccess] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setStatus("unauthenticated");
      return;
    }

    try {
      const decoded = jwtDecode(token);

      setUser({
        id: decoded.userId,
        email: decoded.email,
      });

      setAuthProvider(decoded.authProvider || "local");

      setStatus("authenticated");
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setStatus("unauthenticated");
    }
  }, []);

  // Keep tabs in sync: if another tab signs in, signs out or switches
  // account, reload so this tab never acts for a stale session
  useEffect(() => {
    function handleStorage(e) {
      if (e.key === TOKEN_KEY || e.key === null) {
        window.location.reload();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function login(token) {
    localStorage.setItem(TOKEN_KEY, token);
    sendDeviceDetails(token);

    const decoded = jwtDecode(token);
    setUser({
      id: decoded.userId,
      email: decoded.email,
    });
    setAuthProvider(decoded.authProvider || "local");
    setStatus("authenticated");
    setAuthProvider(decoded.authProvider || "local");
  }

  function logout() {
    console.log("LOGOUT USER", user);
    // Also end this user's Continuum Deploy sessions (spec 6.5); best effort
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch(`${import.meta.env.VITE_API_BASE_URL}/oauth/revoke-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setAuthProvider("local");
    setStatus("unauthenticated");
  }

  useEffect(() => {
    logoutRef.current = logout;
  });

  function overrideAuthProvider(provider) {
    setAuthProvider(provider);
  }

  const logoutRef = useRef(null);
  // Your access: once signed in, and again whenever this tab comes back (an admin may have changed your role)
  const loadAccess = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (res.ok) setAccess(await res.json());
      // Signed out everywhere (or the account is gone): sign in again
      else if (res.status === 401) logoutRef.current?.();
      // A disabled account: nothing is open
      else if (res.status === 403) setAccess({ disabled: true, features: [], allFeatures: [], role: null, isAdmin: false });
      // An API from before roles (no /me): everything stays open, as it was
      else if (res.status === 404) setAccess({ legacy: true, features: [], allFeatures: [], role: null, isAdmin: false });
    } catch {
      // offline: keep what's known
    }
  }, []);
  useEffect(() => {
    if (status !== "authenticated") return undefined;
    const first = setTimeout(loadAccess, 0);
    const onVisible = () => document.visibilityState === "visible" && loadAccess();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, loadAccess]);

  /**
   * May you use this feature? Until your access is known, yes (the server
   * refuses anyway); a feature your role has switched off: no.
   */
  // Signed out: no access known (whatever was loaded before)
  const known = status === "authenticated" ? access : null;
  const can = useCallback((feature) => !known || known.legacy || (!known.disabled && known.features.includes(feature)), [known]);
  /** A feature's name, e.g. "Agents". */
  const featureName = useCallback((feature) => known?.allFeatures?.find((f) => f.id === feature)?.label ?? feature, [known]);
  // GitHub is connected: a GitHub sign-in, or Connect GitHub (any sign-in, any email)
  const githubConnected = authProvider === "github" || Boolean(known?.github?.connected);

  /** Connect GitHub to this account: off to GitHub, then back to the import screen. Throws with the reason if it can't start. */
  const connectGithub = useCallback(async () => {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/github/connect`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.message || data.error || "GitHub couldn't be connected. Try again.");
    window.location.assign(data.url);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        authProvider,
        login,
        logout,
        overrideAuthProvider,
        access: known,
        can,
        featureName,
        reloadAccess: loadAccess,
        githubConnected,
        connectGithub,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
