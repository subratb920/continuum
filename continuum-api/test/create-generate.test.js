import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, catalogJson, dependenciesFor } from "../src/create/catalog/index.js";
import { FIELD_RULES } from "../src/create/fields.js";
import { checkChoices, generateProject } from "../src/create/generate.js";

const react = (extra = {}) => ({ kind: "react", variant: "vite", details: { name: "my-app" }, ...extra });
const node = (extra = {}) => ({ kind: "node", variant: "express", details: { name: "my-api" }, ...extra });
const paths = (p) => p.files.map(([path]) => path);
const file = (p, path) => p.files.find(([x]) => x === path)?.[1];

test("catalogue: every reference exists and the JSON has no code", () => {
  for (const kind of KINDS) {
    const groups = new Set(kind.groups.map((g) => g.id));
    const variants = new Set(kind.variants.map((v) => v.id));
    for (const v of kind.variants) {
      assert.equal(typeof v.template.build, "function", `${kind.id}/${v.id} has a template`);
      for (const f of v.details) assert.ok(FIELD_RULES[f.rule], `${kind.id}/${v.id}: rule ${f.rule}`);
      for (const o of v.options ?? []) assert.ok(o.values.some((x) => x.id === o.default), `${kind.id}/${v.id}: default of ${o.id}`);
    }
    const ids = new Set();
    for (const d of kind.dependencies) {
      assert.ok(!ids.has(d.id), `${kind.id}: duplicate ${d.id}`);
      ids.add(d.id);
      assert.ok(groups.has(d.group), `${kind.id}/${d.id}: group ${d.group}`);
      if (Array.isArray(d.appliesTo)) for (const a of d.appliesTo) assert.ok(variants.has(a), `${kind.id}/${d.id}: variant ${a}`);
    }
    for (const d of kind.dependencies) {
      for (const r of d.requires ?? []) assert.ok(ids.has(r), `${kind.id}/${d.id} requires ${r}`);
      for (const c of d.conflicts ?? []) assert.ok(ids.has(c.id) && c.reason, `${kind.id}/${d.id} conflicts ${c.id}`);
    }
  }
  const text = JSON.stringify(catalogJson());
  assert.ok(!text.includes("apply") && !text.includes("template"), "no code in the public catalogue");
});

test("choices: unknown kind, variant, dependency and bad names are refused with the field", () => {
  const field = (c) => {
    try {
      checkChoices(c);
    } catch (e) {
      return e.field;
    }
    return null;
  };
  assert.equal(field({ kind: "cobol" }), "kind");
  assert.equal(field(react({ variant: "nope" })), "variant");
  assert.equal(field(react({ dependencies: ["nope"] })), "dependencies");
  assert.equal(field(react({ details: { name: "My App" } })), "details.name");
  assert.equal(field(react({ details: { name: "../evil" } })), "details.name");
  assert.equal(field(react({ options: { language: "cobol" } })), "options.language");
  assert.equal(field(react({ dependencies: ["mui", "chakra"] })), "dependencies");
  assert.equal(field(node({ dependencies: ["pino", "winston"] })), "dependencies");
  assert.equal(field(react()), null);
});

test("react vite (TypeScript): official layout, providers wired, package.json valid", async () => {
  const deps = dependenciesFor(KINDS[0], KINDS[0].variants[0]).map((d) => d.id).filter((id) => id !== "chakra");
  const p = await generateProject(react({ dependencies: deps, details: { name: "my-app", description: "A <test> {app}" } }), { resolve: false });
  for (const f of ["package.json", "index.html", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "src/main.tsx", "src/App.tsx", "src/AppProviders.tsx", "src/store.ts", "src/App.test.tsx", "playwright.config.ts", ".gitignore", "README.md", ".env.example"]) {
    assert.ok(paths(p).includes(f), f);
  }
  const pkg = JSON.parse(file(p, "package.json"));
  assert.equal(pkg.name, "my-app");
  assert.equal(pkg.scripts.build, "tsc -b && vite build");
  assert.ok(pkg.dependencies["react-router"] && pkg.dependencies["@tanstack/react-query"] && pkg.devDependencies.vitest);
  assert.equal(pkg.devDependencies.typescript, "~6.0.0");
  assert.match(file(p, "vite.config.ts"), /tailwindcss\(\)/);
  assert.match(file(p, "src/index.css"), /^@import "tailwindcss";/);
  assert.match(file(p, "src/main.tsx"), /<BrowserRouter><AppProviders><App \/><\/AppProviders><\/BrowserRouter>/);
  assert.match(file(p, "src/AppProviders.tsx"), /<QueryClientProvider client=\{queryClient\}><Provider store=\{store\}>|<Provider store=\{store\}>/);
  assert.match(file(p, "src/App.tsx"), /const description = 'A <test> \{app\}'/, "user text is a JS string, not JSX");
  assert.match(file(p, ".env.example"), /^# Address of your API\nVITE_API_URL=/m);
});

test("react vite (JavaScript): no TypeScript files or packages", async () => {
  const p = await generateProject(react({ options: { language: "js" } }), { resolve: false });
  assert.ok(paths(p).every((f) => !/\.tsx?$/.test(f) && !f.startsWith("tsconfig")));
  const pkg = JSON.parse(file(p, "package.json"));
  assert.equal(pkg.scripts.build, "vite build");
  assert.equal(pkg.devDependencies.typescript, undefined);
});

test("node express: middleware, database start-up, env and tests wired", async () => {
  const p = await generateProject(node({ dependencies: ["cors", "helmet", "mongodb", "redis", "jwt", "pino", "ws", "dotenv", "vitest"] }), { resolve: false });
  const app = file(p, "src/app.ts");
  const index = file(p, "src/index.ts");
  assert.match(app, /app\.use\(cors\(\)\)\napp\.use\(helmet\(\)\)\napp\.use\(pinoHttp\(\)\)\napp\.use\(express\.json\(\)\)/);
  assert.match(index, /^import 'dotenv\/config'/);
  assert.match(index, /await connectMongo\(\)\nawait redis\.connect\(\)/);
  assert.match(index, /new WebSocketServer\(\{ server, path: '\/ws' \}\)/);
  const env = file(p, ".env.example");
  assert.match(env, /^# Port the server listens on\nPORT=3000/);
  assert.match(env, /MONGO_URL=mongodb:\/\/localhost:27017\/my-api/);
  assert.match(env, /JWT_SECRET=\n/, "secrets are left empty");
  const pkg = JSON.parse(file(p, "package.json"));
  assert.equal(pkg.scripts.dev, "node --env-file-if-exists=.env --watch src/index.ts");
  assert.ok(pkg.devDependencies["@types/cors"] && pkg.devDependencies["@types/jsonwebtoken"] && pkg.devDependencies["@types/ws"]);
});

test("generated paths never leave the project and are sorted", async () => {
  const p = await generateProject(node(), { resolve: false });
  const list = paths(p);
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)));
  assert.ok(list.every((f) => !f.startsWith("/") && !f.split("/").includes("..")));
});

test("every compatible pair of dependencies: no file written by both, no clashing imports", async () => {
  for (const kind of KINDS) {
    for (const variant of kind.variants) {
      const deps = dependenciesFor(kind, variant);
      const clash = (a, b) => a.conflicts?.some((c) => c.id === b.id) || b.conflicts?.some((c) => c.id === a.id);
      for (let i = 0; i < deps.length; i++) {
        for (let j = i + 1; j < deps.length; j++) {
          const [a, b] = [deps[i], deps[j]];
          if (clash(a, b)) continue;
          const ids = [...new Set([...(a.requires ?? []), ...(b.requires ?? []), a.id, b.id])];
          // The generator refuses when two dependencies write the same file
          const p = await generateProject({ kind: kind.id, variant: variant.id, details: { name: "pair" }, dependencies: ids }, { resolve: false });
          for (const [path, contents] of p.files) {
            if (!/\.(t|j)sx?$/.test(path)) continue;
            const names = [...String(contents).matchAll(/^import (?:type )?\{([^}]+)\}/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim().replace(/^type /, "")));
            assert.equal(new Set(names).size, names.length, `${kind.id}/${variant.id} ${a.id}+${b.id}: duplicate import in ${path}`);
          }
        }
      }
    }
  }
});

test("two dependencies writing the same file is refused", async () => {
  const kind = KINDS.find((k) => k.id === "node");
  const fake = [
    { id: "x1", name: "X1", description: "", group: kind.groups[0].id, apply: (ctx) => ctx.add("src/same.ts", "a") },
    { id: "x2", name: "X2", description: "", group: kind.groups[0].id, apply: (ctx) => ctx.add("src/same.ts", "b") },
  ];
  kind.dependencies.push(...fake);
  try {
    await assert.rejects(generateProject(node({ dependencies: ["x1", "x2"] }), { resolve: false }), /x1 and x2 both write src\/same\.ts/);
  } finally {
    kind.dependencies.splice(-2, 2);
  }
});

test("Vitest never runs Playwright's e2e tests (every variant offering both)", async () => {
  for (const kind of KINDS) {
    for (const variant of kind.variants) {
      const ids = dependenciesFor(kind, variant).map((d) => d.id);
      if (!ids.includes("vitest") || !ids.includes("playwright")) continue;
      const p = await generateProject({ kind: kind.id, variant: variant.id, details: { name: "both" }, dependencies: ["vitest", "playwright"] }, { resolve: false });
      const config = p.files.find(([f]) => /^(vite|vitest)\.config\.(t|j)s$/.test(f));
      assert.ok(config, `${kind.id}/${variant.id}: a Vitest config`);
      assert.match(String(config[1]), /exclude: \['e2e\/\*\*'/, `${kind.id}/${variant.id}: e2e excluded`);
    }
  }
});

test("every kind generates with its defaults (no network needed)", async () => {
  for (const kind of KINDS) {
    for (const variant of kind.variants) {
      if (kind.id === "spring") continue; // generated by start.spring.io (tested in the build checks)
      const p = await generateProject({ kind: kind.id, variant: variant.id }, { resolve: false });
      assert.ok(p.name, `${kind.id}/${variant.id}: a project name`);
      assert.ok(p.files.some(([f]) => f === "README.md"), `${kind.id}/${variant.id}: README`);
      assert.ok(p.files.some(([f]) => f === ".gitignore"), `${kind.id}/${variant.id}: .gitignore`);
    }
  }
});
