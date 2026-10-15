// src/oauth/detect-databases.js
//
// Which database a repository's code uses (MongoDB, PostgreSQL or MySQL), from
// its dependency files, docker-compose files and the *names* in .env.example.
// Values are never read from .env files. Used to pre-select the database in
// Continuum Deploy; returns the engines found, most evidence first.

/** Files worth reading, by name, and what each tells. */
const DEP_FILES = new Set(["package.json", "requirements.txt", "pyproject.toml", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json", "schema.prisma"]);
const COMPOSE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const ENV_EXAMPLE = /^\.env\.(example|sample|template)$/;
import { runtimeOf, RUNTIME_FILES } from "./detect-runtime.js";

/** The settings an app runs with in the cloud (committed; secrets by name only). */
const ENV_PRODUCTION = ".env.production";

/** Words in dependency files → engine. */
const PACKAGES = {
  mongodb: [/\bmongoose\b/, /["']mongodb["']/, /\bpymongo\b/, /\bmotor\b/, /mongo-driver/, /spring-boot-starter-data-mongodb/, /\bmongoid\b/, /mongodb\/mongodb/],
  postgres: [/["']pg["']/, /["']postgres["']/, /pg-promise/, /\bpsycopg2?\b/, /\bpsycopg\b/, /\basyncpg\b/, /lib\/pq\b/, /jackc\/pgx/, /org\.postgresql/, /\bpg\b.*gem|gem ["']pg["']/, /provider\s*=\s*"postgresql"/],
  mysql: [/["']mysql2?["']/, /\bPyMySQL\b/i, /\bmysqlclient\b/, /go-sql-driver\/mysql/, /mysql-connector/, /gem ["']mysql2["']/, /provider\s*=\s*"mysql"/],
};
const IMAGES = { mongodb: /image:\s*["']?mongo(:|["'\s]|$)/m, postgres: /image:\s*["']?(postgres|postgis)/m, mysql: /image:\s*["']?(mysql|mariadb)/m };
/** Setting names → engine (the name is what the app reads, so it's kept). */
const ENV_NAMES = { mongodb: /^(MONGO(DB)?_(URI|URL)|DB_URI|MONGO_URI)$/, postgres: /^(POSTGRES(QL)?_URL|PG_URL|PGDATABASE)$/, mysql: /^(MYSQL_URL|MYSQL_DATABASE|MYSQL_URI)$/ };

/**
 * files: [{ path, text }]. Returns [{ engine, envName, evidence }], best first.
 */
export function detectDatabases(files) {
  const found = { mongodb: { evidence: new Set(), envName: null }, postgres: { evidence: new Set(), envName: null }, mysql: { evidence: new Set(), envName: null } };
  for (const f of files) {
    const name = f.path.split("/").pop();
    if (name === "Dockerfile" || name === ENV_PRODUCTION) continue; // read for its port / settings only
    if (ENV_EXAMPLE.test(name)) {
      // Names only: "NAME=" at the start of a line; the value after = is ignored
      for (const line of f.text.split("\n")) {
        const key = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1];
        if (!key) continue;
        for (const [engine, re] of Object.entries(ENV_NAMES)) {
          if (re.test(key)) {
            found[engine].evidence.add(`${key} in ${f.path}`);
            found[engine].envName ??= key;
          }
        }
        // DATABASE_URL: the scheme of its example decides (only the scheme is looked at)
        if (key === "DATABASE_URL") {
          const v = line.slice(line.indexOf("=") + 1);
          const engine = /^\s*["']?mysql:/.test(v) ? "mysql" : /^\s*["']?mongodb(\+srv)?:/.test(v) ? "mongodb" : /^\s*["']?postgres(ql)?:/.test(v) ? "postgres" : null;
          if (engine) {
            found[engine].evidence.add(`DATABASE_URL (${engine}) in ${f.path}`);
            found[engine].envName ??= key;
          }
        }
      }
      continue;
    }
    if (COMPOSE.test(name)) {
      for (const [engine, re] of Object.entries(IMAGES)) if (re.test(f.text)) found[engine].evidence.add(`a ${engine === "postgres" ? "postgres" : engine} service in ${f.path}`);
      continue;
    }
    for (const [engine, list] of Object.entries(PACKAGES)) {
      const hit = list.find((re) => re.test(f.text));
      if (hit) found[engine].evidence.add(`${hit.source.replace(/\\b|["'\\[\]]/g, "").replace(/\?/g, "").slice(0, 30)} in ${f.path}`);
    }
  }
  return Object.entries(found)
    .filter(([, v]) => v.evidence.size)
    .map(([engine, v]) => ({ engine, envName: v.envName, evidence: [...v.evidence].slice(0, 4) }))
    .sort((a, b) => b.evidence.length - a.evidence.length);
}

/**
 * A .env file's settings: NAME=value lines (quotes removed, "export " and
 * comments ignored). Values are kept as written; an empty one is a secret
 * whose value is entered elsewhere.
 */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    if (/^"(.*)"$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, "\n");
    else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/** The setting names an app's .env.example files list (names only: values are never read). */
export function settingNamesOf(files) {
  const names = new Set();
  for (const f of files) {
    if (!ENV_EXAMPLE.test(f.path.split("/").pop())) continue;
    for (const line of f.text.split("\n")) {
      const key = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1];
      if (key) names.add(key);
    }
  }
  return [...names].slice(0, 200);
}

/**
 * Per app folder: what its own files say (database and setting names). A file
 * belongs to the deepest app folder that holds it.
 */
export function byFolder(files, appFolders, paths = []) {
  const owner = (path) => {
    const dir = path.split("/").slice(0, -1).join("/");
    let best = null;
    for (const f of appFolders) if ((f === "" || dir === f || dir.startsWith(`${f}/`)) && (best === null || f.length > best.length)) best = f;
    return best;
  };
  const groups = new Map();
  for (const f of appFolders) if (paths.length) groups.set(f, []);
  for (const f of files) {
    const o = owner(f.path);
    if (o === null) continue;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o).push(f);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([folder, group]) => {
      // The port its Dockerfile says it uses (EXPOSE), if any: a hint, not a setting
      const docker = group.find((f) => f.path.split("/").pop() === "Dockerfile" && f.path.split("/").slice(0, -1).join("/") === folder);
      const exposed = docker ? Number(/^\s*EXPOSE\s+(\d{2,5})/im.exec(docker.text)?.[1] ?? 0) || null : null;
      // Its own .env.production (directly in the folder): the settings Continuum Deploy uses in the cloud
      const prod = group.find((f) => f.path.split("/").pop() === ENV_PRODUCTION && f.path.split("/").slice(0, -1).join("/") === folder);
      const envProduction = prod ? parseEnvFile(prod.text) : null;
      const names = [...new Set([...settingNamesOf(group), ...Object.keys(envProduction ?? {})])];
      // How it runs (a server, a static front end to build and serve, or nothing that starts), from its own files
      const runtime = paths.length ? runtimeOf(files, paths, folder) : null;
      return [folder, { databases: detectDatabases(group), settingNames: names, ...(exposed ? { exposedPort: exposed } : {}), ...(envProduction ? { envProduction } : {}), ...(runtime ? { runtime } : {}) }];
    }),
  );
}

/** Which files of a repository tree to read for detection (at most 30, small ones). */
export function filesToRead(tree, skipDirs) {
  return tree
    .filter((i) => i.type === "blob" && (i.size ?? 0) < 200_000)
    .filter((i) => !i.path.split("/").some((p) => skipDirs.has(p)) && i.path.split("/").length <= 3)
    .filter((i) => {
      const name = i.path.split("/").pop();
      return DEP_FILES.has(name) || COMPOSE.test(name) || ENV_EXAMPLE.test(name) || name === "Dockerfile" || name === ENV_PRODUCTION || RUNTIME_FILES.test(name);
    })
    .slice(0, 40)
    .map((i) => i.path);
}
