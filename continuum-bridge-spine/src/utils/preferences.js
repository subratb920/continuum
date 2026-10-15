import { useSyncExternalStore } from "react";

/**
 * Preferences kept on this device (Settings card). A missing or unreadable
 * value means the default; storage may be blocked (private windows), and
 * then the defaults simply apply. Changes are announced, so open screens
 * follow them at once.
 */
const KEY = "continuum_prefs";
const EVENT = "continuum:prefs";

export const DEFAULT_PREFERENCES = Object.freeze({
  // General
  intervalSound: true,
  desktopNotifications: true,
  clock: "auto", // auto | 12 | 24
  // Projects
  folderOptionDefault: false, // tick "Create a folder on this device" by default
  openFilesOnSelect: false, // open a device project's files when it's selected
  // Developer
  debugLogs: false,
  // Appearance
  theme: "light", // light | dark | system (follows the device)
  reduceMotion: false,
  compactLists: false,
});

let cache = null;

function read() {
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function getPreferences() {
  return (cache ??= read());
}

export function setPreference(name, value) {
  cache = { ...getPreferences(), [name]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* kept for this visit only */
  }
  applyAppearance(cache);
  window.dispatchEvent(new Event(EVENT));
  return cache;
}

/** Back to the defaults (Developer → Reset settings on this device). */
export function resetPreferences() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  cache = { ...DEFAULT_PREFERENCES };
  applyAppearance(cache);
  window.dispatchEvent(new Event(EVENT));
  return cache;
}

function subscribe(onChange) {
  const onStorage = (e) => {
    if (e.key === KEY) {
      cache = read();
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage); // another tab changed them
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current preferences, re-rendering when they change. */
export function usePreferences() {
  return useSyncExternalStore(subscribe, getPreferences);
}

const darkQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** The theme in use: dark, or light ("system" follows the device). */
export function resolvedTheme(prefs = getPreferences()) {
  if (prefs.theme === "dark") return "dark";
  if (prefs.theme === "system") return darkQuery?.matches ? "dark" : "light";
  return "light";
}

/** Appearance settings on <html>: data-theme (theme-dark.css) and classes (appearance.css). */
export function applyAppearance(prefs = getPreferences()) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(prefs);
  root.classList.toggle("reduce-motion", Boolean(prefs.reduceMotion));
  root.classList.toggle("compact-lists", Boolean(prefs.compactLists));
}

// "System": follow the device when it switches between light and dark
darkQuery?.addEventListener?.("change", () => applyAppearance());
