// The UI built once (in its image), its settings given when it starts.
//
// Vite writes each VITE_ setting into the built files. In the cloud those
// settings are only known when the app starts (Continuum Deploy gives them,
// e.g. VITE_API_BASE_URL = continuum-api's address), so the UI used to be
// built at start-up: slow, and more memory than a small pod has. Now:
//   node scripts/runtime-env.mjs build   (in the image) builds with a
//       placeholder for every VITE_ setting the code reads
//   node scripts/runtime-env.mjs apply   (at start) puts each setting's value
//       in place of its placeholder (empty when it isn't set)
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const NAMES_FILE = join(DIST, ".runtime-env.json");
const placeholder = (name) => `__CONTINUUM_ENV_${name}__`;

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
  // Real settings in the environment take priority over the .env files: placeholders win here
  const env = { ...process.env, ...Object.fromEntries(names.map((n) => [n, placeholder(n)])) };
  const r = spawnSync("npx", ["vite", "build"], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  writeFileSync(NAMES_FILE, JSON.stringify(names));
  console.log(`built with placeholders for ${names.length} settings: ${names.join(", ")}`);
} else if (mode === "apply") {
  const names = JSON.parse(readFileSync(NAMES_FILE, "utf8"));
  // Each value lands inside a quoted string in the built code: escaped as such
  const value = (n) => JSON.stringify(process.env[n] ?? "").slice(1, -1);
  let changed = 0;
  for (const f of filesIn(DIST, (p) => /\.(js|html|css|json|webmanifest)$/.test(p) && !p.endsWith(".runtime-env.json"))) {
    const before = readFileSync(f, "utf8");
    let after = before;
    for (const n of names) after = after.split(placeholder(n)).join(value(n));
    if (after !== before) {
      writeFileSync(f, after);
      changed++;
    }
  }
  console.log(`settings applied to ${changed} files (${names.filter((n) => process.env[n]).join(", ") || "none set"})`);
} else {
  console.error("usage: node scripts/runtime-env.mjs build | apply");
  process.exit(2);
}
