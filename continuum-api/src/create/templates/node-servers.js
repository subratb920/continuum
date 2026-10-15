// src/create/templates/node-servers.js
//
// Node.js servers besides Express: Fastify, Koa, Hono and plain node:http.
// Like Express (node-express.js), TypeScript runs directly on Node 22.22+
// and `tsc` builds to dist/. Every template has the same start-up file, so
// the shared dependencies (databases, realtime, dotenv) fit all of them:
//   startTop, startImports, startup (awaited before listening), afterServer
//   (code using the http `server`). Framework slots: appImports, middleware.

import { jsString } from "../catalog/common.js";
import { json } from "./starter.js";

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

/** src/index: start-up (dependencies' slots), then the server */
function indexFile(ctx, ts, { imports, server, listen }) {
  const ext = ts ? "ts" : "js";
  const top = ctx.slots.startTop ?? [];
  const all = [...imports, ...(ctx.slots.startImports ?? [])].map((i) => i.replaceAll("{ext}", ext));
  const startup = ctx.slots.startup ?? [];
  const after = ctx.slots.afterServer ?? [];
  return `${top.map((l) => `${l}\n`).join("")}${all.join("\n")}

const port = Number(process.env.PORT ?? 3000)
${startup.length ? `\n${startup.join("\n")}\n` : ""}
${server}
${after.length ? `\n${after.join("\n\n")}\n` : ""}
${listen}
`;
}

/** What every Node server template shares: scripts, tsconfig, env, README */
function nodeCommon(ctx, { gitignore, ts }) {
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
  if (ts) ctx.add("tsconfig.json", json(TSCONFIG));
  ctx.readme.setup.push("{run} dev");
  ctx.readme.notes.push(
    "The server listens on http://localhost:3000 (`PORT` in `.env`).",
    ts ? "- `{run} build` compiles to `dist/`; `{run} start` runs it." : "- `{run} start` runs it without watching.",
    "Requires Node.js 22.22 or newer."
  );
}

function prepareNode(ctx, packages) {
  const ts = ctx.options.language === "ts";
  ctx.meta.serverKind = ctx.variant.id;
  for (const [name, range, dev] of packages) {
    if (!dev || ts) ctx.pkg("npm", name, range, { dev: Boolean(dev) });
  }
  if (ts) {
    ctx.pkg("npm", "typescript", "~6.0.0", { dev: true });
    ctx.pkg("npm", "@types/node", "^24.0.0", { dev: true });
  }
}

const greeting = (ctx, framework) => `{ name: ${jsString(ctx.details.name)}, message: 'Hello from ${framework}' }`;

/* ----------------------------------------------------------------- Fastify */

export function nodeFastifyTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare: (ctx) => prepareNode(ctx, [["fastify", "^5.0.0"]]),
    build(ctx) {
      const ts = ctx.options.language === "ts";
      nodeCommon(ctx, { gitignore, ts });
      const imports = ["import Fastify from 'fastify'", ...(ctx.slots.appImports ?? [])];
      ctx.add(
        `src/app.${ts ? "ts" : "js"}`,
        `${imports.join("\n")}

/** The app, built fresh for the server and for each test */
export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
${(ctx.slots.middleware ?? []).map((m) => `  ${m}\n`).join("")}
  app.get('/', async () => (${greeting(ctx, "Fastify")}))

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
`
      );
      ctx.add(
        `src/index.${ts ? "ts" : "js"}`,
        indexFile(ctx, ts, {
          imports: ["import { buildApp } from './app.{ext}'"],
          server: "const app = await buildApp()",
          listen: "await app.listen({ port, host: '0.0.0.0' })",
        })
      );
    },
  };
}

/* --------------------------------------------------------------------- Koa */

export function nodeKoaTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare: (ctx) =>
      prepareNode(ctx, [
        ["koa", "^3.0.0"],
        ["@koa/router", "^15.0.0"],
        ["@koa/bodyparser", "^6.0.0"],
        ["@types/koa", "^3.0.0", true],
        ["@types/koa__router", "^15.0.0", true],
      ]),
    build(ctx) {
      const ts = ctx.options.language === "ts";
      nodeCommon(ctx, { gitignore, ts });
      const imports = ["import Koa from 'koa'", "import Router from '@koa/router'", "import { bodyParser } from '@koa/bodyparser'", ...(ctx.slots.appImports ?? [])];
      ctx.add(
        `src/app.${ts ? "ts" : "js"}`,
        `${imports.join("\n")}

export const app = new Koa()
const router = new Router()

router.get('/', (ctx) => {
  ctx.body = ${greeting(ctx, "Koa")}
})

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

${[...(ctx.slots.middleware ?? []), "app.use(bodyParser())", "app.use(router.routes())", "app.use(router.allowedMethods())"].join("\n")}
`
      );
      ctx.add(
        `src/index.${ts ? "ts" : "js"}`,
        indexFile(ctx, ts, {
          imports: ["import { createServer } from 'node:http'", "import { app } from './app.{ext}'"],
          server: "const server = createServer(app.callback())",
          listen: "server.listen(port, () => {\n  console.log(`Listening on http://localhost:${port}`)\n})",
        })
      );
    },
  };
}

/* -------------------------------------------------------------------- Hono */

export function nodeHonoTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare: (ctx) => prepareNode(ctx, [["hono", "^4.0.0"], ["@hono/node-server", "^2.0.0"]]),
    build(ctx) {
      const ts = ctx.options.language === "ts";
      nodeCommon(ctx, { gitignore, ts });
      const imports = ["import { Hono } from 'hono'", ...(ctx.slots.appImports ?? [])];
      ctx.add(
        `src/app.${ts ? "ts" : "js"}`,
        `${imports.join("\n")}

export const app = new Hono()

${(ctx.slots.middleware ?? []).join("\n")}${ctx.slots.middleware?.length ? "\n\n" : ""}app.get('/', (c) => c.json(${greeting(ctx, "Hono")}))

app.get('/health', (c) => c.json({ status: 'ok' }))
`
      );
      ctx.add(
        `src/index.${ts ? "ts" : "js"}`,
        indexFile(ctx, ts, {
          imports: ["import { serve } from '@hono/node-server'", "import { app } from './app.{ext}'"],
          server: "const server = serve({ fetch: app.fetch, port }, (info) => {\n  console.log(`Listening on http://localhost:${info.port}`)\n})",
          listen: "",
        })
      );
    },
  };
}

/* ---------------------------------------------------------- Plain node:http */

export function nodePlainTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare: (ctx) => prepareNode(ctx, []),
    build(ctx) {
      const ts = ctx.options.language === "ts";
      nodeCommon(ctx, { gitignore, ts });
      const t = (s) => (ts ? s : "");
      ctx.add(
        `src/app.${ts ? "ts" : "js"}`,
        `${ts ? "import type { IncomingMessage, ServerResponse } from 'node:http'\n\n" : ""}function send(res${t(": ServerResponse")}, status${t(": number")}, body${t(": unknown")}) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Every request comes here: a small router on method and path */
export function app(req${t(": IncomingMessage")}, res${t(": ServerResponse")}) {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, ${greeting(ctx, "Node.js")})
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { status: 'ok' })
  }
  send(res, 404, { error: 'Not found' })
}
`
      );
      ctx.add(
        `src/index.${ts ? "ts" : "js"}`,
        indexFile(ctx, ts, {
          imports: ["import { createServer } from 'node:http'", "import { app } from './app.{ext}'"],
          server: "const server = createServer(app)",
          listen: "server.listen(port, () => {\n  console.log(`Listening on http://localhost:${port}`)\n})",
        })
      );
    },
  };
}

/* ------------------------------------------------------------------ NestJS */

/** NestJS as `nest new` creates it (ESM, Vitest, oxlint, Prettier); see NOTICE. */
export function nestTemplate() {
  return {
    manifest: "npm",
    prepare(ctx) {
      ctx.meta.serverKind = "nest";
      for (const p of ["common", "core", "platform-express"]) ctx.pkg("npm", `@nestjs/${p}`, "^12.0.0");
      ctx.pkg("npm", "reflect-metadata", "^0.2.2");
      ctx.pkg("npm", "rxjs", "^7.8.1");
      for (const [name, range] of [
        ["@nestjs/cli", "^12.0.0"],
        ["@nestjs/schematics", "^12.0.0"],
        ["@nestjs/testing", "^12.0.0"],
        ["@types/express", "^5.0.0"],
        ["@types/node", "^24.0.0"],
        ["@types/supertest", "^7.0.0"],
        ["@vitest/coverage-v8", "^4.1.0"],
        ["oxlint", "^1.58.0"],
        ["oxlint-tsgolint", "^7.0.0"],
        ["prettier", "^3.4.2"],
        ["source-map-support", "^0.5.21"],
        ["supertest", "^7.0.0"],
        ["typescript", "^6.0.2"],
        ["vite", "^8.0.0"],
        ["vitest", "^4.1.2"],
      ]) {
        ctx.pkg("npm", name, range, { dev: true });
      }
    },
    build(ctx) {
      const modules = ctx.slots.nestModules ?? [];
      const setup = ctx.slots.nestMainSetup ?? [];
      const mainImports = ctx.slots.nestMainImports ?? [];
      Object.assign(ctx.scripts, {
        build: "nest build",
        format: 'prettier --write "src/**/*.ts" "test/**/*.ts"',
        start: "nest start",
        "start:dev": "nest start --watch",
        "start:debug": "nest start --debug --watch",
        "start:prod": "node dist/main",
        lint: "oxlint --type-aware src/ test/",
        test: "vitest run",
        "test:watch": "vitest",
        "test:cov": "vitest run --coverage",
        "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
      });
      ctx.env.unshift(["PORT", "3000", "Port the server listens on"]);
      // npm 10 (bundled with Node 22) fails to install NestJS 12's starter; npm 11+ works.
      // engine-strict makes an older npm stop with a clear message instead.
      ctx.slot("packageFields", { engines: { node: ">=22.12.0", npm: ">=11" } });
      ctx.add(".npmrc", "engine-strict=true\n");
      ctx.readme.notes.push("NestJS needs npm 11 or newer (`npm install -g npm@latest`), or use pnpm, Yarn or Bun.");
      ctx.add(
        ".gitignore",
        "# compiled output\n/dist\n/node_modules\n/build\n\n# Logs\nlogs\n*.log\nnpm-debug.log*\npnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n\n# OS\n.DS_Store\n\n# Tests\n/coverage\n/.nyc_output\n\n# IDEs and editors\n/.idea\n.project\n.classpath\n*.launch\n.settings/\n*.sublime-workspace\n\n# IDE - VSCode\n.vscode/*\n!.vscode/settings.json\n!.vscode/tasks.json\n!.vscode/launch.json\n!.vscode/extensions.json\n\n# dotenv environment variable files\n.env\n.env.development.local\n.env.test.local\n.env.production.local\n.env.local\n\n# temp directory\n.temp\n.tmp\n\n# Runtime data\npids\n*.pid\n*.seed\n*.pid.lock\n\n# Diagnostic reports (https://nodejs.org/api/report.html)\nreport.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json\n"
      );
      ctx.add(".gitattributes", "* text=auto eol=lf\n");
      ctx.add(".prettierrc", json({ singleQuote: true, trailingComma: "all" }));
      ctx.add(
        ".oxlintrc.json",
        json({ $schema: "./node_modules/oxlint/configuration_schema.json", rules: { "typescript/no-explicit-any": "off", "typescript/no-floating-promises": "error" }, env: { node: true } })
      );
      ctx.add("nest-cli.json", json({ $schema: "https://json.schemastore.org/nest-cli", collection: "@nestjs/schematics", sourceRoot: "src", compilerOptions: { deleteOutDir: true } }));
      ctx.add(
        "tsconfig.json",
        json({
          compilerOptions: {
            module: "nodenext",
            moduleResolution: "nodenext",
            resolvePackageJsonExports: true,
            esModuleInterop: true,
            isolatedModules: true,
            declaration: true,
            removeComments: true,
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            allowSyntheticDefaultImports: true,
            target: "ES2023",
            sourceMap: true,
            outDir: "./dist",
            rootDir: ".",
            incremental: true,
            skipLibCheck: true,
            strict: true,
            strictPropertyInitialization: false,
            types: ["vitest/globals", "node"],
          },
        })
      );
      ctx.add("tsconfig.build.json", json({ extends: "./tsconfig.json", compilerOptions: { rootDir: "./src" }, include: ["src"], exclude: ["node_modules", "test", "dist", "**/*spec.ts"] }));
      const vitestConfig = (include, comment) => `import { defineConfig } from 'vitest/config';

export default defineConfig({${comment}
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['${include}'],
  },
});
`;
      ctx.add(
        "vitest.config.ts",
        vitestConfig("**/*.spec.ts", "\n  // Resolves the path aliases declared in tsconfig.json, including the ones\n  // added by `nest g library`. Requires Vite 8, which ships this option.")
      );
      ctx.add("vitest.config.e2e.ts", vitestConfig("**/*.e2e-spec.ts", ""));
      ctx.add(
        "src/main.ts",
        `${(ctx.slots.startTop ?? []).map((l) => `${l}\n`).join("")}import { NestFactory } from '@nestjs/core';
${mainImports.map((i) => `${i}\n`).join("")}import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
${setup.map((l) => `  ${l.replaceAll("\n", "\n  ")}\n`).join("")}  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
`
      );
      ctx.add(
        "src/app.module.ts",
        `import { Module } from '@nestjs/common';
${modules.map((m) => `${m.import}\n`).join("")}import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [${modules.map((m) => `\n    ${m.call},`).join("")}${modules.length ? "\n  " : ""}],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`
      );
      ctx.add(
        "src/app.controller.ts",
        `import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
`
      );
      ctx.add(
        "src/app.service.ts",
        `import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return ${jsString(`Hello from ${ctx.details.name}!`)};
  }
}
`
      );
      ctx.add(
        "src/app.controller.spec.ts",
        `import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should greet', () => {
      expect(appController.getHello()).toBe(${jsString(`Hello from ${ctx.details.name}!`)});
    });
  });
});
`
      );
      ctx.add(
        "test/app.e2e-spec.ts",
        `import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
`
      );
      ctx.readme.setup.push("{run} start:dev");
      ctx.readme.notes.push(
        "The server listens on http://localhost:3000.",
        "- `{run} build` then `{run} start:prod` for production; `{run} test` runs the unit tests, `{run} test:e2e` the end-to-end tests."
      );
    },
  };
}
