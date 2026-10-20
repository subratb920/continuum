// Where continuum-api and Continuum's page are (given when the app starts in the cloud)
export const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "http://localhost:45170").replace(/\/+$/, "");
export const CONTINUUM_URL = String(import.meta.env.VITE_CONTINUUM_URL || "http://localhost:45173").replace(/\/+$/, "");
export const CLIENT_ID = "continuum-directory";
