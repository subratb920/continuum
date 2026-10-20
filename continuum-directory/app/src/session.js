// Signing in to the Directory through Continuum: OAuth 2.0 authorization code
// with PKCE (no secret: this page is a public client). Continuum's page asks
// you nothing more when you're signed in there; this page gets a short-lived
// access token (kept in memory only) and a refresh token kept for this tab
// (sessionStorage: gone when the tab closes).
import { API_BASE, CLIENT_ID, CONTINUUM_URL } from "./config";

const PENDING = "continuum_directory_signin"; // { state, verifier, returnTo } while away at Continuum
const REFRESH = "continuum_directory_refresh";

let access = null; // { token, expiresAt }
let refreshing = null;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => `${location.origin}/callback`;

const store = {
  get: (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      // this tab only, while open
    }
  },
};

/** Off to Continuum to sign in; back at /callback. */
export async function signIn(returnTo = location.pathname + location.search) {
  const verifier = random(48);
  const state = random(24);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  store.set(PENDING, JSON.stringify({ state, verifier, returnTo: returnTo.startsWith("/callback") ? "/" : returnTo }));
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: "S256" });
  location.assign(`${CONTINUUM_URL}/sso/authorize?${q}`);
}

async function tokenCall(body) {
  const res = await fetch(`${API_BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_description || "Signing in didn't work."), { code: data.error });
  access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 600) * 1000 };
  store.set(REFRESH, data.refresh_token ?? null);
  return access.token;
}

let finishing = null;

/** Back from Continuum: the code becomes tokens (once per page, however often it's asked). → where to go next. */
export function finishSignIn() {
  finishing ??= exchangeCode();
  return finishing;
}

async function exchangeCode() {
  const params = new URLSearchParams(location.search);
  const pending = JSON.parse(store.get(PENDING) || "null");
  store.set(PENDING, null);
  if (params.get("error")) throw new Error(params.get("error_description") || "Continuum didn't sign you in.");
  if (!pending || !params.get("code") || params.get("state") !== pending.state) throw new Error("That sign-in link isn't this tab's. Sign in again.");
  await tokenCall({ grant_type: "authorization_code", code: params.get("code"), code_verifier: pending.verifier, redirect_uri: redirectUri() });
  return pending.returnTo || "/";
}

/** A valid access token (refreshed when near its end), or null when signed out. */
export async function accessToken({ force = false } = {}) {
  if (!force && access && access.expiresAt - Date.now() > 30_000) return access.token;
  const refresh = store.get(REFRESH);
  if (!refresh) return null;
  refreshing ??= tokenCall({ grant_type: "refresh_token", refresh_token: refresh })
    .catch(() => {
      access = null;
      store.set(REFRESH, null);
      return null;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Signs out of the Directory (Continuum stays signed in). */
export async function signOut() {
  const refresh = store.get(REFRESH);
  access = null;
  store.set(REFRESH, null);
  if (refresh) await fetch(`${API_BASE}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: CLIENT_ID, token: refresh }), keepalive: true }).catch(() => {});
}
