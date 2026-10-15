// src/oauth/detect-runtime.js
//
// How an app runs, from its own files (never from a README): a server that
// starts itself, or a static front end that is built and then served as files.
// Used by Continuum Deploy to serve front ends (Vite, React Scripts, Angular,
// Astro, Parcel, SvelteKit static, Vue CLI, plain HTML) without a Dockerfile.

/** Dependencies that mean the app is (or includes) a server: never treated as static. */
const SERVER_DEPS = [
  "express", "fastify", "koa", "hono", "@hono/node-server", "@nestjs/core", "next", "nuxt", "@remix-run/serve", "@remix-run/node",
  "@sveltejs/adapter-node", "@astrojs/node", "socket.io", "ws", "http-server", "serve", "@hapi/hapi", "restify", "polka", "h3", "nitropack",
];

/** Front-end build tools → where their build puts the site (relative to the app folder). */
const BUILDERS = [
  { dep: "@angular/build", outDir: "dist", angular: true },
  { dep: "@angular-devkit/build-angular", outDir: "dist", angular: true },
  { dep: "react-scripts", outDir: "build" },
  { dep: "@sveltejs/adapter-static", outDir: "build" },
  { dep: "astro", outDir: "dist" },
  { dep: "@vue/cli-service", outDir: "dist" },
  { dep: "parcel", outDir: "dist" },
  { dep: "vite", outDir: "dist" },
];

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

/**
 * files: [{ path, text }] read from the repository (package.json, angular.json,
 * vite.config.*); paths: every file path in the repository; folder: the app's
 * folder ("" = root). → { kind: "static", outDir, packageManager, buildScript, evidence }
 * | { kind: "server", evidence } | { kind: "none", evidence } (can't tell how it starts) | null (not Node/HTML).
 */
export function runtimeOf(files, paths, folder) {
  const at = (name) => (folder ? `${folder}/${name}` : name);
  const has = (name) => paths.includes(at(name));
  const read = (name) => files.find((f) => f.path === at(name))?.text ?? null;

  const pkgText = read("package.json");
  if (!pkgText) {
    // Plain HTML: an index.html and no package.json
    return has("index.html") ? { kind: "static", outDir: ".", packageManager: null, buildScript: null, evidence: ["index.html, no package.json"] } : null;
  }
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch {
    return null;
  }
  const scripts = pkg.scripts ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const server = SERVER_DEPS.filter((d) => d in (pkg.dependencies ?? {}) || (d === "next" || d === "nuxt") && d in deps);
  if (scripts.start) return { kind: "server", evidence: [`"start": ${scripts.start}`] };
  if (server.length) return { kind: "server", evidence: [`depends on ${server.join(", ")}`] };
  if (pkg.main && has(pkg.main)) return { kind: "server", evidence: [`"main": ${pkg.main}`] };

  const builder = BUILDERS.find((b) => b.dep in deps);
  if (builder && scripts.build) {
    let outDir = builder.outDir;
    if (builder.angular) {
      // angular.json: projects.<first>.architect.build.options.outputPath (the files are in its browser/ folder)
      try {
        const cfg = JSON.parse(read("angular.json") ?? "{}");
        const project = Object.values(cfg.projects ?? {})[0];
        const out = project?.architect?.build?.options?.outputPath;
        const base = typeof out === "string" ? out : out?.base;
        if (base) outDir = `${base}/browser`;
      } catch {
        /* the default */
      }
    } else if (builder.dep === "vite") {
      const viteCfg = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"].map(read).find(Boolean);
      const m = viteCfg && /outDir\s*:\s*["'`]([^"'`]+)["'`]/.exec(viteCfg);
      if (m && !m[1].includes("..")) outDir = m[1].replace(/^\.\//, "");
    }
    const packageManager = LOCKFILES.find(([file]) => has(file))?.[1] ?? "npm";
    return { kind: "static", outDir, packageManager, buildScript: "build", evidence: [`${builder.dep} with a "build" script`, `no "start" script, no server dependency`] };
  }
  // A Node app with nothing to start: no start script, no server, no main file, not a known front end
  const entry = ["index.js", "server.js", "app.js", "main.js", "src/index.js", "src/server.js"].find(has);
  if (entry) return { kind: "server", evidence: [`${entry} (buildpacks run node ${entry === "index.js" ? "index.js" : entry})`] };
  return { kind: "none", evidence: [`no "start" script, no server dependency, no index.js${scripts.build ? ", and no known front-end build tool" : ""}`] };
}

/** Files the runtime check reads besides dependency files. */
export const RUNTIME_FILES = /^(angular\.json|vite\.config\.(ts|js|mts|mjs))$/;
