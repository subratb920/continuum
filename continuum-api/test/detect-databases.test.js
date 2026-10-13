import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDatabases, filesToRead } from "../src/oauth/detect-databases.js";

test("mongoose plus MONGO_URI in .env.example: MongoDB, read as MONGO_URI", () => {
  const r = detectDatabases([
    { path: "package.json", text: '{"dependencies":{"express":"4","mongoose":"8"}}' },
    { path: ".env.example", text: "PORT=3000\nMONGO_URI=mongodb://localhost/app\n" },
  ]);
  assert.equal(r[0].engine, "mongodb");
  assert.equal(r[0].envName, "MONGO_URI");
  assert.equal(r.length, 1);
});

test("Postgres from Python and compose; MySQL from mysql2; nothing from an empty app", () => {
  assert.equal(detectDatabases([{ path: "requirements.txt", text: "fastapi\npsycopg2-binary==2.9\n" }, { path: "docker-compose.yml", text: "services:\n  db:\n    image: postgres:16\n" }])[0].engine, "postgres");
  assert.equal(detectDatabases([{ path: "api/package.json", text: '{"dependencies":{"mysql2":"3"}}' }])[0].engine, "mysql");
  assert.deepEqual(detectDatabases([{ path: "package.json", text: '{"dependencies":{"react":"18"}}' }]), []);
});

test("DATABASE_URL's example scheme decides the engine; values are never returned", () => {
  const r = detectDatabases([{ path: ".env.example", text: "DATABASE_URL=mysql://root:secret@localhost/shop\n" }]);
  assert.equal(r[0].engine, "mysql");
  assert.ok(!JSON.stringify(r).includes("secret"));
});

test("only dependency files, compose files and .env.example are read; never .env", () => {
  const tree = [
    { type: "blob", path: "package.json", size: 100 },
    { type: "blob", path: ".env", size: 100 },
    { type: "blob", path: ".env.example", size: 100 },
    { type: "blob", path: "node_modules/x/package.json", size: 100 },
    { type: "blob", path: "docker-compose.yml", size: 100 },
    { type: "blob", path: "src/index.js", size: 100 },
  ];
  assert.deepEqual(filesToRead(tree, new Set(["node_modules"])), ["package.json", ".env.example", "docker-compose.yml"]);
});

test("per app folder: each app's own database and setting names (names only); a file belongs to its deepest app folder", async () => {
  const { byFolder } = await import("../src/oauth/detect-databases.js");
  const files = [
    { path: "api/package.json", text: '{"dependencies":{"pg":"8"}}' },
    { path: "api/.env.example", text: "DATABASE_URL=postgres://u:secret@localhost/shop\nJWT_SECRET=x\n" },
    { path: "web/.env.example", text: "VITE_API_URL=http://localhost:3000\n" },
    { path: "web/package.json", text: '{"dependencies":{"react":"18"}}' },
    { path: "docs/.env.example", text: "IGNORED=1\n" },
  ];
  const r = byFolder(files, ["api", "web"]);
  assert.deepEqual(Object.keys(r).sort(), ["api", "web"]);
  assert.equal(r.api.databases[0].engine, "postgres");
  assert.deepEqual(r.api.settingNames, ["DATABASE_URL", "JWT_SECRET"]);
  assert.deepEqual(r.web, { databases: [], settingNames: ["VITE_API_URL"] });
  assert.ok(!JSON.stringify(r).includes("secret@"), "values are never returned");
});
