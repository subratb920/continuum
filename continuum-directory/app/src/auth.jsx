import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { meApi } from "./api";
import { accessToken, finishSignIn, signIn, signOut as endSession } from "./session";

const AuthContext = createContext(null);

/**
 * Who's here: signed in through Continuum (session.js), and what the
 * directory says about you (GET /directory/me: kind, role, features, admin).
 * status: checking | signed-in | error
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const m = await meApi.get();
    setMe(m);
    setStatus("signed-in");
    return m;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Back from Continuum: the code becomes this tab's sign-in
        if (location.pathname === "/callback") history.replaceState(null, "", await finishSignIn());
        if (!(await accessToken())) return void (await signIn());
        if (live) await load();
      } catch (err) {
        if (!live) return;
        setError(err.message);
        setStatus("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const value = {
    status,
    error,
    access: me,
    can: (feature) => !!me?.features?.includes(feature),
    reloadAccess: load,
    signIn: () => signIn("/"),
    async signOut() {
      await endSession();
      setMe(null);
      setStatus("signed-out");
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
