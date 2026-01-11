import { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "continuum_token";

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); 
  // "checking" | "unauthenticated" | "authenticated"
  const [token, setToken] = useState(null);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);

    if (storedToken) {
      setToken(storedToken);
      setStatus("authenticated");
    } else {
      setStatus("unauthenticated");
    }
  }, []);

  function login(newToken) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setStatus("authenticated");
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setStatus("unauthenticated");
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        token,
        isAuthenticated: status === "authenticated",
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
