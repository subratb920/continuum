#!/usr/bin/env node
/**
 * Builds src/theme-dark.generated.css from the light stylesheets.
 *
 * Every colour a stylesheet sets is mapped to its dark counterpart by role
 * (page, pane, card, hover, border, text …) using a ChatGPT-style dark palette,
 * and written as the same rule under :root[data-theme="dark"]. Run it again
 * after changing colours in any stylesheet:
 *
 *   node scripts/build-dark-theme.mjs
 *
 * Hand-made dark rules (page background, header, panes, primary buttons …)
 * live in src/theme-dark.css, which loads after this file and wins.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const OUT = join(SRC, "theme-dark.generated.css");

/** Already dark, or not part of the themed app. */
const SKIP_FILES = new Set(["auth/AuthGate.css", "screens/GithubImport.css", "theme-dark.css", "theme-dark.generated.css", "appearance.css"]);
const SKIP_SELECTOR = /github-import|auth-|^\s*(from|to|\d+%)\s*$/;

// ---------- The palette (ChatGPT dark) ----------
const P = {
  card: "#2f2f2f", // cards, menus, inputs
  pane: "#171717", // side panes, insets
  hover: "#3a3a3a", // hover, chips, selected rows
  control: "#4a4a4a", // switch tracks, inactive dots
  dim: "#6b6b6b",
  border: "#383838",
  borderStrong: "#5a5a5a",
  text: "#ececec",
  text2: "#b4b4b4",
  text3: "#8e8e8e",
  accent: "#ececec", // ChatGPT uses light neutrals for primary actions and highlights
  onAccent: "#0d0d0d",
  green: "#10a37f",
};

// ---------- Colours ----------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

function parse(tok) {
  if (NAMED[tok]) return NAMED[tok];
  let m = /^#([0-9a-f]{3,8})$/i.exec(tok);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(tok);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
}

function hsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function rgbOf(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;

/** Bluish greys (slate) that are greys, not tints. */
const SLATE = new Set(["#f8fafc", "#f1f5f9", "#e2e8f0", "#e6edf3", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a"]);

function kind(c) {
  const [h, s, l] = hsl(c);
  const spread = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  // Near-white colours show their tint at a small spread (#eef2ff, #f0fdf4); darker greys tolerate more
  const neutral = SLATE.has(hex(c)) || (l >= 0.9 ? spread < 10 : spread < 40);
  const indigo = !neutral && h >= 200 && h <= 265 && s > 0.4;
  const green = !neutral && h >= 85 && h <= 165 && s > 0.35;
  return { h, s, l, neutral, indigo, green };
}

/** A colour → its dark-theme counterpart, by the property's role. */
function mapColor(c, role) {
  const [, , , a] = c;
  const k = kind(c);
  const tint = (alpha) => rgba(rgbOf(k.h, Math.min(k.s, 0.7), 0.6), alpha);

  if (role === "shadow") {
    if (k.l < 0.3) return rgba([0, 0, 0], Math.min(0.7, a * 1.8)); // dark shadows: stronger
    return k.neutral ? rgba([255, 255, 255], 0.08) : tint(0.35); // light or coloured rings
  }

  if (role === "bg") {
    if (a < 1 && k.l < 0.3) return rgba([0, 0, 0], Math.min(0.72, a * 1.9)); // scrims
    if (k.neutral) {
      if (k.l >= 0.995) return P.card;
      if (k.l >= 0.965) return P.pane;
      if (k.l >= 0.9) return P.hover;
      if (k.l >= 0.75) return P.control;
      if (k.l >= 0.5) return P.dim;
      return null; // already dark
    }
    if (k.l >= 0.85) return k.indigo ? P.hover : tint(0.16); // selection highlights: ChatGPT's neutral grey; other tints keep their hue
    if (k.indigo) return P.accent; // primary buttons, accent bars
    if (k.green) return P.green;
    return null; // other strong colours (red, amber, pink …) read fine on dark
  }

  if (role === "text") {
    if (k.neutral) {
      if (k.l >= 0.85) return null; // light text (on coloured buttons) stays
      if (k.l < 0.3) return P.text;
      if (k.l < 0.5) return P.text2;
      return P.text3;
    }
    if (k.indigo && k.l < 0.7) return P.text; // selected labels and links: near-white, as in ChatGPT
    if (k.green) return "#19c37d";
    if (k.l < 0.7) return hex(rgbOf(k.h, Math.min(k.s, 0.85), 0.74)); // dark coloured text → light
    return null;
  }

  // border / outline
  if (k.neutral) {
    if (k.l >= 0.75) return P.border;
    if (k.l >= 0.5) return P.borderStrong;
    return null;
  }
  if (k.l >= 0.75) return tint(0.38);
  if (k.indigo) return P.accent;
  if (k.green) return P.green;
  return null;
}

function roleOf(prop) {
  if (prop.includes("shadow")) return "shadow";
  if (prop.startsWith("background")) return "bg";
  if (prop === "color" || prop === "caret-color" || prop === "fill" || prop === "stroke") return "text";
  if (prop.includes("border") || prop.includes("outline")) return "border";
  return null;
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(white|black)\b/g;

function mapValue(value, role) {
  let changed = false;
  let lightBg = false;
  const out = value.replace(COLOR_TOKEN, (tok) => {
    const c = parse(tok.toLowerCase());
    if (!c) return tok;
    const m = mapColor(c, role);
    if (!m) return tok;
    changed = true;
    if (role === "bg" && m === P.accent) lightBg = true;
    return m;
  });
  return changed ? { value: out, lightBg } : null;
}

// ---------- Stylesheets ----------
function cssFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : n.endsWith(".css") ? [p] : [];
  });
}

const blocks = [];
let count = 0;
for (const file of cssFiles(SRC).sort()) {
  const rel = relative(SRC, file);
  if (SKIP_FILES.has(rel)) continue;
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("@") && !SKIP_SELECTOR.test(s));
    if (!selectors.length) continue;
    const decls = [];
    let needsDarkText = false;
    let hasText = false;
    for (const raw of m[2].split(";")) {
      const i = raw.indexOf(":");
      if (i < 0) continue;
      const prop = raw.slice(0, i).trim().toLowerCase();
      const value = raw.slice(i + 1).trim();
      const role = roleOf(prop);
      if (!role) continue;
      if (role === "text") hasText = true;
      const mapped = mapValue(value, role);
      if (!mapped) continue;
      if (mapped.lightBg) needsDarkText = true;
      decls.push(`  ${prop}: ${mapped.value};`);
    }
    // A light (accent) background needs dark text on it
    if (needsDarkText && !decls.some((d) => d.trim().startsWith("color:"))) decls.push(`  color: ${P.onAccent};`);
    else if (needsDarkText && hasText) {
      const at = decls.findIndex((d) => d.trim().startsWith("color:"));
      if (at >= 0) decls[at] = `  color: ${P.onAccent};`;
    }
    if (!decls.length) continue;
    count += decls.length;
    const sel = selectors.map((s) => `:root[data-theme="dark"] ${s.replace(/^(html|:root)\b/, "")}`.replace(/\s+/g, " ").trim()).join(",\n");
    rules.push(`${sel} {\n${decls.join("\n")}\n}`);
  }
  if (rules.length) blocks.push(`/* ---- ${rel} ---- */\n${rules.join("\n\n")}`);
}

writeFileSync(
  OUT,
  `/* GENERATED by scripts/build-dark-theme.mjs — do not edit by hand.
   The light stylesheets' colours mapped to the dark (ChatGPT-style) palette.
   Hand-made dark rules: src/theme-dark.css (loads after this file). */\n\n${blocks.join("\n\n")}\n`,
);
console.log(`theme-dark.generated.css: ${count} declarations from ${blocks.length} stylesheets`);
