/* global __BUILD_DATE__ */
/**
 * How to reach the Continuum team (Support and Contact us cards).
 * VITE_SUPPORT_EMAIL / VITE_SUPPORT_PHONE in the app's settings; without a
 * phone number, "Call us" says it's coming soon.
 */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "continuum.console@gmail.com";
export const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || "";

/** When this build was made (shown as the app's version). */
export const BUILD = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "dev";

/** What the team needs to look into a problem (no secrets: an ID, the page, the browser). */
export function diagnostics(user, authProvider) {
  return [
    `User ID: ${user?.id ?? "—"}`,
    `Email: ${user?.email ?? "—"}`,
    `Signed in with: ${authProvider === "github" ? "GitHub" : "email"}`,
    `Page: ${window.location.pathname}`,
    `Build: ${BUILD}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}×${window.innerHeight}`,
  ].join("\n");
}

/** A mailto: link with a subject and a pre-filled body. */
export function mailto(subject, body) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
