/**
 * Small screens: which part of each screen was showing ("left" | "right" |
 * null for its middle), so a screen tab brings you back to where you were.
 * For this page load only.
 */
const lastPart = new Map();

export function rememberPart(screenId, part) {
  lastPart.set(screenId, part);
}

export function rememberedPart(screenId) {
  return lastPart.get(screenId) ?? null;
}
