import { useEffect, useRef } from "react";
import { useAuth } from "../state/authStore";

export default function AuthCallback() {
  const { login } = useAuth();
  // Run once: login() re-renders with a new function, which would run this
  // again on an address that no longer has the token (and send you home)
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    try {
      // ✅ Parse token from URL (no React Router needed); never logged
      const token = new URLSearchParams(window.location.search).get("token");

      if (!token) {
        console.error("AuthCallback: No token found in URL");
        window.location.replace("/");
        return;
      }

      // ✅ Store token + update auth state
      login(token);

      // ✅ This callback is only used by GitHub sign-in: show the
      // Import from GitHub page once, right after signing in.
      // replace() also drops the address with the token from history.
      window.location.replace("/import");
    } catch (err) {
      console.error("AuthCallback error:", err);
      window.location.replace("/");
    }
  }, [login]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f1115",
        color: "#e6e6e6",
        fontFamily: "system-ui",
      }}
    >
      Signing you in...
    </div>
  );
}