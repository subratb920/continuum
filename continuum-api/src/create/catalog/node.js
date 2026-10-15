// src/create/catalog/node.js
//
// Node.js server projects. TypeScript runs directly on Node 22.22+ (type
// stripping), and `tsc` builds to dist/ for production.

import { LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION, NPM_DETAILS, NODE_GITIGNORE, jsString, npm } from "./common.js";
import { nodeExpressTemplate } from "../templates/node-express.js";
import { nestTemplate, nodeFastifyTemplate, nodeHonoTemplate, nodeKoaTemplate, nodePlainTemplate } from "../templates/node-servers.js";

/** Plain servers sharing the start-up file (databases, realtime, dotenv fit all) */
const SERVERS = ["express", "fastify", "koa", "hono", "node"];
const WITH_HTTP_SERVER = ["express", "koa", "hono", "node"];
const v = (ctx) => ctx.variant.id;

const GROUPS = [
  { id: "web", name: "Web" },
  { id: "security", name: "Security" },
  { id: "databases", name: "Databases" },
  { id: "auth", name: "Authentication" },
  { id: "validation", name: "Validation" },
  { id: "logging", name: "Logging" },
  { id: "realtime", name: "Realtime" },
  { id: "config", name: "Configuration" },
  { id: "testing", name: "Testing" },
  { id: "tooling", name: "Tooling" },
];

const ts = (ctx) => ctx.options.language === "ts";
const ext = (ctx) => (ts(ctx) ? "ts" : "js");

const DEPENDENCIES = [
  {
    id: "cors",
    name: "CORS",
    description: "Let browsers on other origins call the API.",
    group: "web",
    docs: "https://developer.mozilla.org/docs/Web/HTTP/CORS",
    appliesTo: ["express", "fastify", "koa", "hono", "nest"],
    apply(ctx) {
      switch (v(ctx)) {
        case "express":
          ctx.pkg("npm", "cors", "^2.8.5");
          if (ts(ctx)) ctx.pkg("npm", "@types/cors", "^2.8.0", { dev: true });
          ctx.slot("appImports", "import cors from 'cors'");
          ctx.slot("middleware", "app.use(cors())");
          break;
        case "fastify":
          ctx.pkg("npm", "@fastify/cors", "^11.0.0");
          ctx.slot("appImports", "import cors from '@fastify/cors'");
          ctx.slot("middleware", "await app.register(cors)");
          break;
        case "koa":
          ctx.pkg("npm", "@koa/cors", "^5.0.0");
          if (ts(ctx)) ctx.pkg("npm", "@types/koa__cors", "^5.0.0", { dev: true });
          ctx.slot("appImports", "import cors from '@koa/cors'");
          ctx.slot("middleware", "app.use(cors())");
          break;
        case "hono":
          ctx.slot("appImports", "import { cors } from 'hono/cors'");
          ctx.slot("middleware", "app.use('*', cors())");
          break;
        case "nest":
          ctx.slot("nestMainSetup", "app.enableCors();");
          break;
      }
    },
  },
  {
    id: "helmet",
    name: "Secure headers (Helmet)",
    description: "Secure HTTP headers in one line.",
    group: "security",
    docs: "https://helmetjs.github.io/",
    appliesTo: ["express", "fastify", "koa", "hono", "nest"],
    apply(ctx) {
      switch (v(ctx)) {
        case "express":
        case "nest":
          ctx.pkg("npm", "helmet", "^8.0.0");
          if (v(ctx) === "nest") {
            ctx.slot("nestMainImports", "import helmet from 'helmet';");
            ctx.slot("nestMainSetup", "app.use(helmet());");
          } else {
            ctx.slot("appImports", "import helmet from 'helmet'");
            ctx.slot("middleware", "app.use(helmet())");
          }
          break;
        case "fastify":
          ctx.pkg("npm", "@fastify/helmet", "^13.0.0");
          ctx.slot("appImports", "import helmet from '@fastify/helmet'");
          ctx.slot("middleware", "await app.register(helmet)");
          break;
        case "koa":
          ctx.pkg("npm", "koa-helmet", "^9.0.0");
          ctx.slot("appImports", "import helmet from 'koa-helmet'");
          ctx.slot("middleware", "app.use(helmet())");
          break;
        case "hono":
          ctx.slot("appImports", "import { secureHeaders } from 'hono/secure-headers'");
          ctx.slot("middleware", "app.use('*', secureHeaders())");
          break;
      }
    },
  },
  {
    id: "mongodb",
    appliesTo: SERVERS,
    name: "MongoDB driver",
    description: "The official MongoDB client, connected at start-up from MONGO_URL.",
    group: "databases",
    icon: "SiMongodb",
    docs: "https://www.mongodb.com/docs/drivers/node/current/",
    packages: [npm("mongodb", "^7.0.0")],
    apply(ctx) {
      ctx.add(
        `src/db/mongo.${ext(ctx)}`,
        `import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017')

/** The app's database, once connected */
export const db = client.db()

export async function connectMongo()${ts(ctx) ? ": Promise<void>" : ""} {
  await client.connect()
}
`
      );
      ctx.slot("startImports", `import { connectMongo } from './db/mongo.${ext(ctx)}'`);
      ctx.slot("startup", "await connectMongo()");
      ctx.env.push(["MONGO_URL", `mongodb://localhost:27017/${ctx.details.name.replace(/^@[^/]+\//, "")}`, "MongoDB connection string"]);
    },
  },
  {
    id: "mongoose",
    name: "Mongoose",
    description: "MongoDB object modelling with schemas.",
    group: "databases",
    icon: "SiMongoose",
    docs: "https://mongoosejs.com/docs/",
    packages: [npm("mongoose", "^9.0.0")],
    conflicts: [{ id: "mongodb", reason: "Mongoose already includes the MongoDB driver." }],
    appliesTo: [...SERVERS, "nest"],
    apply(ctx) {
      if (v(ctx) === "nest") {
        ctx.pkg("npm", "@nestjs/mongoose", "^12.0.0");
        ctx.slot("nestModules", {
          import: "import { MongooseModule } from '@nestjs/mongoose';",
          call: "MongooseModule.forRoot(process.env.MONGO_URL ?? 'mongodb://localhost:27017')",
        });
        ctx.env.push(["MONGO_URL", `mongodb://localhost:27017/${ctx.details.name.replace(/^@[^/]+\//, "")}`, "MongoDB connection string"]);
        ctx.readme.notes.push("The end-to-end tests start the whole app, so MongoDB must be running for `test:e2e`.");
        return;
      }
      ctx.add(
        `src/db/mongoose.${ext(ctx)}`,
        `import mongoose from 'mongoose'

export async function connectMongoose()${ts(ctx) ? ": Promise<void>" : ""} {
  await mongoose.connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017')
}
`
      );
      ctx.slot("startImports", `import { connectMongoose } from './db/mongoose.${ext(ctx)}'`);
      ctx.slot("startup", "await connectMongoose()");
      ctx.env.push(["MONGO_URL", `mongodb://localhost:27017/${ctx.details.name.replace(/^@[^/]+\//, "")}`, "MongoDB connection string"]);
    },
  },
  {
    id: "pg",
    appliesTo: SERVERS,
    name: "PostgreSQL (node-postgres)",
    description: "A PostgreSQL connection pool from DATABASE_URL.",
    group: "databases",
    icon: "SiPostgresql",
    docs: "https://node-postgres.com/",
    packages: [npm("pg", "^8.0.0")],
    conflicts: [{ id: "mysql", reason: "both use DATABASE_URL; choose one SQL database." }],
    apply(ctx) {
      if (ts(ctx)) ctx.pkg("npm", "@types/pg", "^8.0.0", { dev: true });
      ctx.add(
        `src/db/postgres.${ext(ctx)}`,
        `import pg from 'pg'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function connectPostgres()${ts(ctx) ? ": Promise<void>" : ""} {
  await pool.query('select 1')
}
`
      );
      ctx.slot("startImports", `import { connectPostgres } from './db/postgres.${ext(ctx)}'`);
      ctx.slot("startup", "await connectPostgres()");
      ctx.env.push(["DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres", "PostgreSQL connection string"]);
    },
  },
  {
    id: "mysql",
    appliesTo: SERVERS,
    name: "MySQL (mysql2)",
    description: "A MySQL connection pool from DATABASE_URL.",
    group: "databases",
    icon: "SiMysql",
    docs: "https://sidorares.github.io/node-mysql2/docs",
    packages: [npm("mysql2", "^3.0.0")],
    conflicts: [{ id: "pg", reason: "both use DATABASE_URL; choose one SQL database." }],
    apply(ctx) {
      ctx.add(
        `src/db/mysql.${ext(ctx)}`,
        `import mysql from 'mysql2/promise'

export const pool = mysql.createPool(process.env.DATABASE_URL ?? 'mysql://root@localhost:3306/mysql')

export async function connectMysql()${ts(ctx) ? ": Promise<void>" : ""} {
  await pool.query('select 1')
}
`
      );
      ctx.slot("startImports", `import { connectMysql } from './db/mysql.${ext(ctx)}'`);
      ctx.slot("startup", "await connectMysql()");
      ctx.env.push(["DATABASE_URL", "mysql://root:password@localhost:3306/app", "MySQL connection string"]);
    },
  },
  {
    id: "redis",
    appliesTo: SERVERS,
    name: "Redis",
    description: "The official Redis client, connected at start-up from REDIS_URL.",
    group: "databases",
    icon: "SiRedis",
    docs: "https://redis.io/docs/latest/develop/clients/nodejs/",
    packages: [npm("redis", "^6.0.0")],
    apply(ctx) {
      ctx.add(
        `src/db/redis.${ext(ctx)}`,
        `import { createClient } from 'redis'

export const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })
`
      );
      ctx.slot("startImports", `import { redis } from './db/redis.${ext(ctx)}'`);
      ctx.slot("startup", "await redis.connect()");
      ctx.env.push(["REDIS_URL", "redis://localhost:6379", "Redis connection string"]);
    },
  },
  {
    id: "jwt",
    appliesTo: [...SERVERS, "nest"],
    name: "JSON Web Tokens",
    description: "Sign and check JWTs, with a ready requireAuth middleware.",
    group: "auth",
    icon: "SiJsonwebtokens",
    docs: "https://github.com/auth0/node-jsonwebtoken",
    packages: [npm("jsonwebtoken", "^9.0.0")],
    apply(ctx) {
      const t = ts(ctx);
      if (t) ctx.pkg("npm", "@types/jsonwebtoken", "^9.0.0", { dev: true });
      ctx.add(
        `src/auth.${ext(ctx)}`,
        v(ctx) !== "express"
          ? `import jwt from 'jsonwebtoken'

const secret = () => {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is not set')
  return value
}

export function signToken(payload${t ? ": object" : ""})${t ? ": string" : ""} {
  return jwt.sign(payload, secret(), { expiresIn: '1h' })
}

/** The token's claims, or null when it isn't valid */
export function verifyToken(token${t ? ": string" : ""}) {
  try {
    return jwt.verify(token, secret())
  } catch {
    return null
  }
}
`
          :
        `${t ? "import type { NextFunction, Request, Response } from 'express'\n" : ""}import jwt from 'jsonwebtoken'

const secret = () => {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is not set')
  return value
}

export function signToken(payload${t ? ": object" : ""})${t ? ": string" : ""} {
  return jwt.sign(payload, secret(), { expiresIn: '1h' })
}

/** Lets a request through only with a valid "Authorization: Bearer <token>" */
export function requireAuth(req${t ? ": Request" : ""}, res${t ? ": Response" : ""}, next${t ? ": NextFunction" : ""}) {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  try {
    res.locals.user = jwt.verify(token ?? '', secret())
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
`
      );
      ctx.env.push(["JWT_SECRET", "", "A long random value used to sign tokens (keep it secret)"]);
    },
  },
  {
    id: "bcrypt",
    appliesTo: [...SERVERS, "nest"],
    name: "bcrypt",
    description: "Hash and check passwords.",
    group: "auth",
    docs: "https://github.com/kelektiv/node.bcrypt.js",
    packages: [npm("bcrypt", "^6.0.0")],
    apply(ctx) {
      if (ts(ctx)) ctx.pkg("npm", "@types/bcrypt", "^6.0.0", { dev: true });
    },
  },
  {
    id: "passport",
    appliesTo: [...SERVERS, "nest"],
    name: "Passport",
    description: "Authentication middleware with 500+ strategies.",
    group: "auth",
    icon: "SiPassport",
    docs: "https://www.passportjs.org/",
    packages: [npm("passport", "^0.7.0")],
    apply(ctx) {
      if (ts(ctx)) ctx.pkg("npm", "@types/passport", "^1.0.0", { dev: true });
    },
  },
  {
    id: "zod",
    appliesTo: [...SERVERS, "nest"],
    name: "Zod",
    description: "TypeScript-first schema validation for request bodies.",
    group: "validation",
    icon: "SiZod",
    docs: "https://zod.dev/",
    packages: [npm("zod", "^4.0.0")],
  },
  {
    id: "joi",
    appliesTo: [...SERVERS, "nest"],
    name: "Joi",
    description: "Schema description and data validation.",
    group: "validation",
    docs: "https://joi.dev/",
    packages: [npm("joi", "^18.0.0")],
  },
  {
    id: "pino",
    appliesTo: ["express"],
    name: "Pino",
    description: "Fast JSON logging, with request logs (pino-http).",
    group: "logging",
    icon: "SiPino",
    docs: "https://getpino.io/",
    packages: [npm("pino", "^10.0.0"), npm("pino-http", "^11.0.0")],
    conflicts: [{ id: "winston", reason: "two loggers; choose one." }],
    apply(ctx) {
      ctx.slot("appImports", "import { pinoHttp } from 'pino-http'");
      ctx.slot("middleware", "app.use(pinoHttp())");
    },
  },
  {
    id: "winston",
    appliesTo: [...SERVERS, "nest"],
    name: "Winston",
    description: "A logger with many transports.",
    group: "logging",
    docs: "https://github.com/winstonjs/winston",
    packages: [npm("winston", "^3.0.0")],
    apply(ctx) {
      ctx.add(
        `src/logger.${ext(ctx)}`,
        `import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
})
`
      );
    },
  },
  {
    id: "ws",
    appliesTo: WITH_HTTP_SERVER,
    name: "WebSockets (ws)",
    description: "A WebSocket server on the same port, at /ws.",
    group: "realtime",
    docs: "https://github.com/websockets/ws",
    packages: [npm("ws", "^8.0.0")],
    conflicts: [{ id: "socketio", reason: "two realtime servers; choose one." }],
    apply(ctx) {
      if (ts(ctx)) ctx.pkg("npm", "@types/ws", "^8.0.0", { dev: true });
      ctx.slot("startImports", "import { WebSocketServer } from 'ws'");
      ctx.slot("afterServer", `const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (socket) => {
  socket.on('message', (message) => socket.send(\`echo: \${message}\`))
})`);
    },
  },
  {
    id: "socketio",
    appliesTo: WITH_HTTP_SERVER,
    name: "Socket.IO",
    description: "Realtime events with rooms and automatic reconnection.",
    group: "realtime",
    icon: "SiSocketdotio",
    docs: "https://socket.io/docs/v4/",
    packages: [npm("socket.io", "^4.0.0")],
    apply(ctx) {
      ctx.slot("startImports", "import { Server } from 'socket.io'");
      ctx.slot("afterServer", `const io = new Server(server)
io.on('connection', (socket) => {
  socket.on('ping', () => socket.emit('pong'))
})`);
    },
  },
  {
    id: "dotenv",
    appliesTo: [...SERVERS, "nest"],
    name: "dotenv",
    description: "Load settings from a .env file (Node can also do this itself).",
    group: "config",
    icon: "SiDotenv",
    docs: "https://github.com/motdotla/dotenv",
    packages: [npm("dotenv", "^18.0.0")],
    apply(ctx) {
      ctx.slot("startTop", "import 'dotenv/config'");
    },
  },
  {
    id: "vitest",
    name: "Vitest",
    description: "Tests for the API, with a first test for GET /health.",
    group: "testing",
    icon: "SiVitest",
    docs: "https://vitest.dev/",
    appliesTo: SERVERS,
    packages: [npm("vitest", "^5.0.0", true)],
    apply(ctx) {
      ctx.scripts.test = "vitest";
      const x = ext(ctx);
      const body = {
        express: `import request from 'supertest'\nimport { app } from '../src/app.${x}'`,
        koa: `import request from 'supertest'\nimport { app } from '../src/app.${x}'`,
        node: `import request from 'supertest'\nimport { app } from '../src/app.${x}'`,
        fastify: `import { buildApp } from '../src/app.${x}'`,
        hono: `import { app } from '../src/app.${x}'`,
      }[v(ctx)];
      const call = {
        express: "const res = await request(app).get('/health')\n    expect(res.status).toBe(200)\n    expect(res.body).toEqual({ status: 'ok' })",
        koa: "const res = await request(app.callback()).get('/health')\n    expect(res.status).toBe(200)\n    expect(res.body).toEqual({ status: 'ok' })",
        node: "const res = await request(app).get('/health')\n    expect(res.status).toBe(200)\n    expect(res.body).toEqual({ status: 'ok' })",
        fastify: "const app = await buildApp()\n    const res = await app.inject({ method: 'GET', url: '/health' })\n    expect(res.statusCode).toBe(200)\n    expect(res.json()).toEqual({ status: 'ok' })",
        hono: "const res = await app.request('/health')\n    expect(res.status).toBe(200)\n    expect(await res.json()).toEqual({ status: 'ok' })",
      }[v(ctx)];
      if (["express", "koa", "node"].includes(v(ctx))) {
        ctx.pkg("npm", "supertest", "^7.0.0", { dev: true });
        if (ts(ctx)) ctx.pkg("npm", "@types/supertest", "^7.0.0", { dev: true });
      }
      ctx.add(
        `test/app.test.${x}`,
        `${body}
import { describe, expect, it } from 'vitest'

describe('GET /health', () => {
  it('answers ok', async () => {
    ${call}
  })
})
`
      );
    },
  },
  {
    id: "prettier",
    appliesTo: SERVERS,
    name: "Prettier",
    description: "Opinionated code formatter.",
    group: "tooling",
    icon: "SiPrettier",
    docs: "https://prettier.io/",
    packages: [npm("prettier", "^3.0.0", true)],
    apply(ctx) {
      ctx.add(".prettierrc", `${JSON.stringify({ semi: false, singleQuote: true }, null, 2)}\n`);
      ctx.add(".prettierignore", "dist\ncoverage\n");
      ctx.scripts.format = "prettier --write .";
    },
  },
  {
    id: "nest-config",
    name: "Config (@nestjs/config)",
    description: "Settings from .env through ConfigService, available everywhere.",
    group: "config",
    docs: "https://docs.nestjs.com/techniques/configuration",
    appliesTo: ["nest"],
    packages: [npm("@nestjs/config", "^12.0.0")],
    apply(ctx) {
      ctx.slot("nestModules", { import: "import { ConfigModule } from '@nestjs/config';", call: "ConfigModule.forRoot({ isGlobal: true })" });
    },
  },
  {
    id: "nest-swagger",
    name: "OpenAPI (Swagger)",
    description: "API documentation generated from your controllers, at /docs.",
    group: "web",
    docs: "https://docs.nestjs.com/openapi/introduction",
    appliesTo: ["nest"],
    packages: [npm("@nestjs/swagger", "^12.0.0")],
    apply(ctx) {
      ctx.slot("nestMainImports", "import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';");
      ctx.slot(
        "nestMainSetup",
        `const openApi = new DocumentBuilder().setTitle(${jsString(ctx.details.name)}).setVersion('1.0').build();\nSwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));`
      );
    },
  },
  {
    id: "nest-validation",
    name: "Validation (class-validator)",
    description: "Validate request bodies with decorators, through a global ValidationPipe.",
    group: "validation",
    docs: "https://docs.nestjs.com/techniques/validation",
    appliesTo: ["nest"],
    packages: [npm("class-validator", "^0.15.0"), npm("class-transformer", "^0.5.1")],
    apply(ctx) {
      ctx.slot("nestMainImports", "import { ValidationPipe } from '@nestjs/common';");
      ctx.slot("nestMainSetup", "app.useGlobalPipes(new ValidationPipe({ whitelist: true }));");
    },
  },
];

export default {
  id: "node",
  name: "Node.js",
  icon: "SiNodedotjs",
  description: "Servers and APIs on Node.js.",
  groups: GROUPS,
  variants: [
    {
      id: "express",
      name: "Express",
      icon: "SiExpress",
      description: "The minimal, most used Node.js web framework (Express 5).",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nodeExpressTemplate({ gitignore: NODE_GITIGNORE }),
    },
    {
      id: "fastify",
      name: "Fastify",
      icon: "SiFastify",
      description: "A fast, low-overhead web framework with schemas and plugins.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nodeFastifyTemplate({ gitignore: NODE_GITIGNORE }),
    },
    {
      id: "nest",
      name: "NestJS",
      icon: "SiNestjs",
      description: "A structured, TypeScript-first framework (modules, controllers, providers).",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nestTemplate(),
    },
    {
      id: "koa",
      name: "Koa",
      icon: "SiKoa",
      description: "A small, expressive framework by the team behind Express.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nodeKoaTemplate({ gitignore: NODE_GITIGNORE }),
    },
    {
      id: "hono",
      name: "Hono",
      icon: "SiHono",
      description: "A tiny, web-standards framework that runs on Node and at the edge.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nodeHonoTemplate({ gitignore: NODE_GITIGNORE }),
    },
    {
      id: "node",
      name: "Plain Node.js",
      icon: "SiNodedotjs",
      description: "Just node:http, no framework: a small router and a health check.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nodePlainTemplate({ gitignore: NODE_GITIGNORE }),
    },
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: d.appliesTo ?? ["express"] })),
};
