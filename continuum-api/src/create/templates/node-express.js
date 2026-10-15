// src/create/templates/node-express.js
//
// Express 5 on Node.js. TypeScript runs directly on Node 22.22+ (type
// stripping); `tsc` builds to dist/ for production. Dependencies fill the
// slots: appImports, middleware, startTop, startImports, startup, afterServer.

import { jsString } from "../catalog/common.js";

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

const TSCONFIG = {
  compilerOptions: {
    target: "es2023",
    lib: ["ES2023"],
    module: "nodenext",
    moduleResolution: "nodenext",
    types: ["node"],
    rootDir: "src",
    outDir: "dist",
    rewriteRelativeImportExtensions: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    erasableSyntaxOnly: true,
    strict: true,
    skipLibCheck: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
  },
  include: ["src"],
};

function appFile(ctx, ts) {
  const imports = ["import express from 'express'", ...(ctx.slots.appImports ?? [])];
  const t = (s) => (ts ? s : "");
  return `${ts ? "import type { Request, Response } from 'express'\n" : ""}${imports.join("\n")}

export const app = express()

${[...(ctx.slots.middleware ?? []), "app.use(express.json())"].join("\n")}

app.get('/', (_req${t(": Request")}, res${t(": Response")}) => {
  res.json({ name: ${jsString(ctx.details.name)}, message: 'Hello from Express' })
})

app.get('/health', (_req${t(": Request")}, res${t(": Response")}) => {
  res.json({ status: 'ok' })
})
`;
}

function indexFile(ctx, ts) {
  const ext = ts ? "ts" : "js";
  const top = ctx.slots.startTop ?? [];
  const imports = ["import { createServer } from 'node:http'", ...(ctx.slots.startImports ?? []), `import { app } from './app.${ext}'`];
  const startup = ctx.slots.startup ?? [];
  const after = ctx.slots.afterServer ?? [];
  return `${top.map((l) => `${l}\n`).join("")}${imports.join("\n")}

const port = Number(process.env.PORT ?? 3000)
${startup.length ? `\n${startup.join("\n")}\n` : ""}
const server = createServer(app)
${after.length ? `\n${after.join("\n\n")}\n` : ""}
server.listen(port, () => {
  console.log(\`Listening on http://localhost:\${port}\`)
})
`;
}

export function nodeExpressTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare(ctx) {
      const ts = ctx.options.language === "ts";
      ctx.pkg("npm", "express", "^5.0.0");
      if (ts) {
        ctx.pkg("npm", "typescript", "~6.0.0", { dev: true });
        ctx.pkg("npm", "@types/express", "^5.0.0", { dev: true });
        ctx.pkg("npm", "@types/node", "^24.0.0", { dev: true });
      }
    },
    build(ctx) {
      const ts = ctx.options.language === "ts";
      const ext = ts ? "ts" : "js";
      const env = "--env-file-if-exists=.env";
      ctx.scripts.dev = `node ${env} --watch src/index.${ext}`;
      if (ts) {
        ctx.scripts.build = "tsc";
        ctx.scripts.typecheck = "tsc --noEmit";
        ctx.scripts.start = `node ${env} dist/index.js`;
      } else {
        ctx.scripts.start = `node ${env} src/index.js`;
      }
      ctx.slot("packageFields", { engines: { node: ">=22.22" } });
      ctx.env.unshift(["PORT", "3000", "Port the server listens on"]);

      ctx.add(".gitignore", gitignore);
      ctx.add(`src/app.${ext}`, appFile(ctx, ts));
      ctx.add(`src/index.${ext}`, indexFile(ctx, ts));
      if (ts) ctx.add("tsconfig.json", json(TSCONFIG));

      ctx.readme.setup.push("{run} dev");
      ctx.readme.notes.push(
        "The server listens on http://localhost:3000 (`PORT` in `.env`).",
        ts ? "- `{run} build` compiles to `dist/`; `{run} start` runs it." : "- `{run} start` runs it without watching.",
        "Requires Node.js 22.22 or newer."
      );
    },
  };
}
