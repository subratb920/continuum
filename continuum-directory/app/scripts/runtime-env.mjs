// The UI built once (in its image), its settings given when it starts.
//
// Vite writes each VITE_ setting into the built files. In the cloud those
// settings are only known when the app starts (Continuum Deploy gives them,
// e.g. VITE_API_BASE_URL = continuum-api's address), so the UI used to be
// built at start-up: slow, and more memory than a small pod has. Now:
//   node scripts/runtime-env.mjs build   (in the image) builds with every
//       VITE_ setting the code reads taken from globalThis.__CONTINUUM_ENV__
//       (vite.config.js), filled by /runtime-env.js before the app loads
//   node scripts/runtime-env.mjs apply   (at start) writes runtime-env.js
//       with each setting's value (empty when it isn't set)
// The values stay out of the code itself, so a check like
// VITE_DATA_ENABLED === "true" is made when the page runs, not folded away
// by the build.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const NAMES_FILE = join(DIST, ".runtime-env.json");
const SCRIPT = "runtime-env.js";

function filesIn(dir, keep) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesIn(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Every VITE_ setting the UI's code reads. */
function settingNames() {
  const names = new Set();
  for (const f of filesIn(join(ROOT, "src"), (p) => /\.(jsx?|tsx?)$/.test(p))) {
    for (const m of readFileSync(f, "utf8").matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) names.add(m[1]);
  }
  return [...names].sort();
}

const mode = process.argv[2];
if (mode === "build") {
  const names = settingNames();
  // Values from the .env files or this environment must not be written into the code either
  const env = { ...process.env, CONTINUUM_RUNTIME_ENV: JSON.stringify(names) };
  for (const n of names) delete env[n];
  const r = spawnSync("npx", ["vite", "build"], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  // The page loads the settings before the app (its module scripts run after this one)
  const html = join(DIST, "index.html");
  const page = readFileSync(html, "utf8");
  if (!page.includes(`src="/${SCRIPT}"`)) writeFileSync(html, page.replace("<head>", `<head>\n    <script src="/${SCRIPT}"></script>`));
  writeFileSync(join(DIST, SCRIPT), "globalThis.__CONTINUUM_ENV__ = {};\n");
  writeFileSync(NAMES_FILE, JSON.stringify(names));
  // Each setting must be read from that object (not written in by the build)
  const code = filesIn(DIST, (p) => p.endsWith(".js")).map((f) => readFileSync(f, "utf8")).join("\n");
  const missing = names.filter((n) => !code.includes(`__CONTINUUM_ENV__.${n}`));
  if (missing.length) {
    console.error(`these settings aren't read at start: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`built; ${names.length} settings come from /${SCRIPT} at start: ${names.join(", ")}`);
} else if (mode === "apply") {
  const names = JSON.parse(readFileSync(NAMES_FILE, "utf8"));
  const values = Object.fromEntries(names.map((n) => [n, process.env[n] ?? ""]));
  // A script, not markup: JSON is a valid expression; "<" escaped so nothing can close a tag
  writeFileSync(join(DIST, SCRIPT), `globalThis.__CONTINUUM_ENV__ = ${JSON.stringify(values).replace(/</g, "\\u003c")};\n`);
  console.log(`settings applied (${names.filter((n) => process.env[n]).join(", ") || "none set"})`);
} else {
  console.error("usage: node scripts/runtime-env.mjs build | apply");
  process.exit(2);
}
