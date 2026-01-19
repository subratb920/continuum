import { createContext, useContext, useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "continuum_token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); // checking | authenticated | unauthenticated
  const [user, setUser] = useState(null);

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

    setStatus("authenticated");
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setStatus("unauthenticated");
  }

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
