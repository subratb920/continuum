import { useEffect } from "react";
import { useAuth } from "../state/authStore";

export default function AuthCallback() {
  const { login } = useAuth();

  useEffect(() => {
    try {
      // ✅ Parse token from URL (no React Router needed)
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");

      console.log("AuthCallback → token:", token);

      if (!token) {
        console.error("AuthCallback: No token found in URL");
        window.location.href = "/";
        return;
      }

      // ✅ Store token + update auth state
      login(token);

      // ✅ Clean URL (remove token from address bar)
      window.history.replaceState({}, document.title, "/");

      // ✅ Redirect to app root
      setTimeout(() => {
        window.location.href = "/";
      }, 100);
    } catch (err) {
      console.error("AuthCallback error:", err);
      window.location.href = "/";
    }
  }, [login]);

  return (
    <div
      style={{
        height: "100vh",
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