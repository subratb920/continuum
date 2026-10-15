// scripts/verify-templates.mjs
//
// Proves every template builds: generates projects for typical choices (with
// today's resolved versions) into OUT/<case>/, plus OUT/cases.json describing
// what to run in each. scripts/verify-templates.sh then installs, builds,
// lints and tests every one in a clean container.
//
//   node scripts/verify-templates.mjs OUT [filter]

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { generateProject } from "../src/create/generate.js";
import { refreshCatalog } from "../src/create/catalog/index.js";

// Small check containers without IPv6: Java would otherwise try IPv6 first and time out downloading Gradle
// and the Gradle download (via GitHub's release assets) can take longer to connect than the wrapper's 10 s
const JAVA_ENV =
  "export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true; f=gradle/wrapper/gradle-wrapper.properties; [ -f $f ] && sed -i 's/networkTimeout=.*/networkTimeout=60000/' $f; true";

export const CASES = [
  {
    id: "react-vite-ts-full",
    choices: {
      kind: "react", variant: "vite", options: { language: "ts" },
      dependencies: ["router", "redux", "zustand", "react-query", "axios", "tailwind", "mui", "react-hook-form", "zod", "vitest", "playwright", "prettier"],
    },
    run: ["npm install", "npm run build", "npm run lint", "npx vitest run"],
  },
  { id: "react-vite-ts-chakra", choices: { kind: "react", variant: "vite", dependencies: ["chakra", "vitest"] }, run: ["npm install", "npm run build", "npx vitest run"] },
  {
    id: "react-vite-js",
    choices: { kind: "react", variant: "vite", options: { language: "js" }, dependencies: ["router", "redux", "tailwind", "vitest"] },
    run: ["npm install", "npm run build", "npm run lint", "npx vitest run"],
  },
  { id: "react-vite-ts-plain", choices: { kind: "react", variant: "vite" }, run: ["npm install", "npm run build", "npm run lint"] },
  {
    id: "next-ts",
    choices: { kind: "react", variant: "next", dependencies: ["tailwind", "zustand", "redux", "react-query", "axios", "mui", "zod", "playwright", "prettier"] },
    run: ["npm install", "npm run build", "npm run lint"],
  },
  { id: "next-js", choices: { kind: "react", variant: "next", options: { language: "js" }, dependencies: ["tailwind", "axios"] }, run: ["npm install", "npm run build", "npm run lint"] },
  { id: "react-router", choices: { kind: "react", variant: "react-router", dependencies: ["tailwind", "axios", "zod", "zustand"] }, run: ["npm install", "npm run typecheck", "npm run build"] },
  { id: "gatsby", choices: { kind: "react", variant: "gatsby", dependencies: ["zustand", "axios", "react-hook-form"] }, run: ["npm install", "npm run typecheck", "npm run build"] },
  { id: "astro", choices: { kind: "react", variant: "astro", dependencies: ["tailwind", "axios", "zod"] }, run: ["npm install", "npm run build"] },
  {
    id: "vue-vite-ts",
    choices: { kind: "vue", variant: "vite", dependencies: ["vue-router", "pinia", "tailwind", "vitest", "axios", "vueuse", "playwright"] },
    run: ["npm install", "npm run build", "npx vitest run"],
  },
  { id: "vue-vite-js", choices: { kind: "vue", variant: "vite", options: { language: "js" }, dependencies: ["vue-router", "pinia", "vitest"] }, run: ["npm install", "npm run build", "npx vitest run"] },
  { id: "nuxt", choices: { kind: "vue", variant: "nuxt", dependencies: ["pinia", "tailwind", "vueuse", "zod"] }, run: ["npx -y npm@11 install", "npm run build"] },
  { id: "angular", choices: { kind: "angular", variant: "standalone", dependencies: ["material", "tailwind", "zod"] }, run: ["npm install", "npm run build", "npx ng test --watch=false"] },
  { id: "sveltekit", choices: { kind: "svelte", variant: "sveltekit", dependencies: ["tailwind", "axios"] }, run: ["npm install", "npm run check", "npm run build"] },
  { id: "svelte-vite", choices: { kind: "svelte", variant: "vite", dependencies: ["tailwind", "zod"] }, run: ["npm install", "npm run check", "npm run build"] },
  { id: "static", choices: { kind: "static", variant: "site" }, run: ["test -f index.html && test -f styles.css && test -f script.js && node --check script.js"] },
  {
    id: "fastify-ts",
    choices: { kind: "node", variant: "fastify", dependencies: ["cors", "helmet", "mongodb", "redis", "jwt", "zod", "dotenv", "vitest", "prettier"] },
    run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run"],
  },
  { id: "fastify-js", choices: { kind: "node", variant: "fastify", options: { language: "js" }, dependencies: ["cors", "pg", "vitest"] }, run: ["npm install", "npx vitest run"] },
  {
    id: "nest",
    choices: { kind: "node", variant: "nest", dependencies: ["cors", "helmet", "jwt", "bcrypt", "nest-config", "nest-swagger", "nest-validation", "dotenv"] },
    run: ["npx -y npm@11 install", "npm run build", "npm run lint", "npm test", "npm run test:e2e"],
  },
  // The e2e tests start the whole app, so with Mongoose they need a MongoDB: build and unit tests only
  { id: "nest-mongoose", choices: { kind: "node", variant: "nest", dependencies: ["mongoose", "nest-config"] }, run: ["npx -y npm@11 install", "npm run build", "npm run lint", "npm test"] },
  {
    id: "koa-ts",
    choices: { kind: "node", variant: "koa", dependencies: ["cors", "helmet", "mysql", "ws", "winston", "vitest"] },
    run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run"],
  },
  {
    id: "hono-ts",
    choices: { kind: "node", variant: "hono", dependencies: ["cors", "helmet", "redis", "socketio", "jwt", "vitest"] },
    run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run"],
  },
  { id: "node-plain-ts", choices: { kind: "node", variant: "node", dependencies: ["ws", "dotenv", "vitest"] }, run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run", "SERVE"] },
  { id: "node-plain-js", choices: { kind: "node", variant: "node", options: { language: "js" }, dependencies: ["vitest"] }, run: ["npm install", "npx vitest run"] },
  ...[
    ["py-fastapi", "fastapi", ["sqlalchemy", "alembic", "psycopg", "pymongo", "redis", "celery", "pydantic-settings", "dotenv", "httpx"]],
    ["py-flask", "flask", ["sqlalchemy", "flask-cors", "gunicorn", "dotenv", "redis"]],
    ["py-plain", "plain", ["httpx", "dotenv", "pydantic-settings"]],
  ].map(([id, variant, dependencies]) => ({
    id,
    image: "python:3.13-slim",
    choices: { kind: "python", variant, dependencies },
    run: ["pip install -q --root-user-action=ignore -r requirements-dev.txt", "ruff check .", "pytest -q"],
  })),
  {
    id: "py-django",
    image: "python:3.13-slim",
    choices: { kind: "python", variant: "django", dependencies: ["drf", "django-cors", "psycopg", "redis", "celery", "gunicorn", "dotenv"] },
    run: ["pip install -q --root-user-action=ignore -r requirements-dev.txt", "ruff check .", "python manage.py check", "python manage.py test"],
  },
  ...[
    ["go-stdlib", "stdlib", ["cors", "pgx", "mongo", "redis", "jwt", "godotenv", "zerolog", "testify"]],
    ["go-gin", "gin", ["cors", "redis", "jwt"]],
    ["go-echo", "echo", ["cors", "pgx", "godotenv"]],
    ["go-fiber", "fiber", ["cors", "mongo", "testify"]],
  ].map(([id, variant, dependencies]) => ({
    id,
    image: "golang:1.27",
    choices: { kind: "go", variant, dependencies },
    // Fewer parallel compiles: the checks run in small containers
    run: ["export GOFLAGS=-p=1 GOGC=20", "go mod tidy", "test -z \"$(gofmt -l .)\" || (gofmt -l .; exit 1)", "go vet ./...", "go test ./...", "go build ./..."],
  })),
  ...[
    ["dotnet-webapi", "webapi", ["efcore-sqlite", "redis", "scalar", "jwt", "serilog", "fluentvalidation"]],
    ["dotnet-minimal", "minimal", ["efcore-postgres", "mongodb", "jwt", "scalar"]],
    ["dotnet-console", "console", ["spectre", "fluentvalidation"]],
  ].map(([id, variant, dependencies]) => ({
    id,
    image: "mcr.microsoft.com/dotnet/sdk:10.0",
    choices: { kind: "dotnet", variant, dependencies },
    run: ["dotnet test"],
  })),
  {
    id: "spring-maven",
    image: "eclipse-temurin:25-jdk",
    choices: { kind: "spring", variant: "boot", options: { type: "maven-project", language: "java", javaVersion: "25" }, details: { group: "com.example", artifact: "spring-maven" }, dependencies: ["web", "data-jpa", "h2", "validation", "actuator"] },
    run: [JAVA_ENV, "sh mvnw -q -B test"],
  },
  {
    id: "spring-gradle-kotlin",
    // Gradle preinstalled: the wrapper's download host is unreachable from these check containers
    image: "gradle:jdk25",
    choices: { kind: "spring", variant: "boot", options: { type: "gradle-project-kotlin", language: "kotlin", javaVersion: "25" }, details: { group: "com.example", artifact: "spring-gradle-kotlin" }, dependencies: ["web", "actuator"] },
    run: [JAVA_ENV, "gradle test --no-daemon -q -Dorg.gradle.jvmargs=-Xmx768m -Pkotlin.compiler.execution.strategy=in-process"],
  },
  {
    id: "java-maven",
    image: "eclipse-temurin:25-jdk",
    choices: { kind: "java", variant: "app", options: { build: "maven" }, details: { artifact: "java-maven" }, dependencies: ["guava", "jackson", "logging", "lombok", "assertj", "mockito"] },
    run: [JAVA_ENV, "sh mvnw -q -B package", "sh mvnw -q -B compile exec:java"],
  },
  {
    id: "java-gradle",
    image: "gradle:jdk25",
    choices: { kind: "java", variant: "app", options: { build: "gradle" }, details: { artifact: "java-gradle" }, dependencies: ["guava", "logging", "lombok", "assertj"] },
    run: [JAVA_ENV, "gradle build run --no-daemon -q"],
  },
  {
    id: "express-ts-full",
    choices: {
      kind: "node", variant: "express",
      dependencies: ["cors", "helmet", "mongodb", "redis", "jwt", "bcrypt", "passport", "zod", "joi", "pino", "ws", "dotenv", "vitest", "prettier"],
    },
    run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run"],
  },
  {
    id: "express-ts-mix",
    choices: { kind: "node", variant: "express", dependencies: ["mongoose", "mysql", "winston", "socketio", "vitest"] },
    run: ["npm install", "npm run typecheck", "npm run build", "npx vitest run"],
  },
  {
    id: "express-js",
    choices: { kind: "node", variant: "express", options: { language: "js" }, dependencies: ["cors", "pg", "winston", "socketio", "vitest"] },
    run: ["npm install", "npx vitest run"],
  },
  {
    id: "express-ts-plain",
    choices: { kind: "node", variant: "express" },
    run: ["npm install", "npm run build", "SERVE"],
  },
];

const [out, filter] = process.argv.slice(2);
await refreshCatalog(); // Spring Boot's part comes from start.spring.io
if (!out) {
  console.error("usage: node scripts/verify-templates.mjs OUT [filter]");
  process.exit(2);
}
await rm(out, { recursive: true, force: true });
// filter: comma-separated parts of case ids, e.g. "next,vue"
const cases = CASES.filter((c) => !filter || filter.split(",").some((f) => c.id.includes(f)));
for (const c of cases) {
  const project = await generateProject({ ...c.choices, details: { name: c.id, ...c.choices.details } }, { resolve: true });
  for (const [path, contents] of project.files) {
    const full = join(out, c.id, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  console.log(`generated ${c.id}: ${project.files.length} files`);
}
await writeFile(join(out, "cases.json"), JSON.stringify(cases.map((c) => ({ id: c.id, image: c.image ?? null, run: c.run })), null, 2));
