import { createContext, useContext, useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "continuum_token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); // checking | authenticated | unauthenticated
  const [user, setUser] = useState(null);
  const [authProvider, setAuthProvider] = useState("local");

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

  function login(token) {
    localStorage.setItem(TOKEN_KEY, token);

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
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setAuthProvider("local");
    setStatus("unauthenticated");
  }

  function overrideAuthProvider(provider) {
    setAuthProvider(provider);
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        authProvider,
        login,
        logout,
        overrideAuthProvider,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
