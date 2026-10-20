#!/usr/bin/env node
/**
 * Fails when a stylesheet or a component sets a colour itself instead of
 * using a theme token (var(--…) from src/theme/tokens.css), so every screen
 * follows every theme.  npm run check:colors
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["theme/tokens.css"]); // the one place colours are defined
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d|\b(white|black)\b/;
const PROP = /^(color|background(-color)?|border(-[a-z]+)*(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|scrollbar-color|text-decoration-color)$/;

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const problems = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (ALLOWED.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".css")) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      if (PROP.test(m[1].toLowerCase()) && COLOR.test(m[2])) {
        const line = css.slice(0, m.index).split("\n").length;
        problems.push(`${rel}:${line}  ${m[1]}: ${m[2].trim()}`);
      }
    }
  } else if (/\.(jsx?|tsx?)$/.test(file)) {
    for (const m of text.matchAll(/\b(color|background(?:Color)?|border(?:Color)?|fill|stroke)\s*:\s*["'`](#[0-9a-fA-F]{3,8}|rgba?\(\s*\d[^"'`]*|white|black)["'`]/g)) {
      const line = text.slice(0, m.index).split("\n").length;
      problems.push(`${rel}:${line}  ${m[1]}: "${m[2]}"`);
    }
  }
}
if (problems.length) {
  console.error(`${problems.length} colour(s) set outside the theme tokens (use var(--…) from src/theme/tokens.css):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("check:colors: every colour comes from the theme tokens.");
