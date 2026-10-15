import { test } from "node:test";
import assert from "node:assert/strict";
import { repoOf } from "../src/workspaces/routes.js";
import { workspacesClient, WorkspacesUnavailableError } from "../src/workspaces/client.js";

test("workspaces: a project's repository from its full name or GitHub link; none for device-only projects", () => {
  assert.equal(repoOf({ fullName: "octo/app" }), "octo/app");
  assert.equal(repoOf({ githubRepoUrl: "https://github.com/octo/site.git" }), "octo/site");
  assert.equal(repoOf({ githubRepoUrl: "https://github.com/octo/site/" }), "octo/site");
  assert.equal(repoOf({ source: "device" }), null);
  assert.equal(repoOf({ githubRepoUrl: "https://evil.example/octo/app" }), null);
  assert.equal(repoOf({ fullName: "octo/app; rm -rf /" }), null);
});

test("workspaces client: internal paths and bodies; an unreachable service is WorkspacesUnavailableError", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push([init.method, url, init.body ?? null]);
    return { status: 202, json: async () => ({ state: "starting", path: "/w/x/?tkn=t" }) };
  };
  const c = workspacesClient("http://continuum-workspaces:45177/", fake);
  const r = await c.start("a".repeat(24), { repo: "o/r", githubToken: "tok", size: "small" });
  assert.equal(r.data.path, "/w/x/?tkn=t");
  await c.open("a".repeat(24));
  await c.remove("a".repeat(24));
  assert.deepEqual(
    seen.map(([m, u]) => `${m} ${u}`),
    [`POST http://continuum-workspaces:45177/internal/workspaces/${"a".repeat(24)}/start`, `POST http://continuum-workspaces:45177/internal/workspaces/${"a".repeat(24)}/open`, `DELETE http://continuum-workspaces:45177/internal/workspaces/${"a".repeat(24)}`],
  );
  const down = workspacesClient("http://x", async () => {
    throw new Error("ECONNREFUSED");
  });
  await assert.rejects(down.status("a".repeat(24)), WorkspacesUnavailableError);
});

test("put on GitHub: dependencies, git, build output, .env files and escaping paths are never pushed; size limits", async () => {
  const { filesToPush, MAX_FILES } = await import("../src/create/publish.js");
  const f = (path, size = 1) => ({ path, data: Buffer.alloc(size), executable: false });
  const kept = filesToPush([f("src/app.js"), f("node_modules/x/i.js"), f(".git/config"), f("dist/a.js"), f(".env"), f("api/.env.production"), f("../etc/passwd"), f("/abs"), f("README.md")]).map((x) => x.path);
  assert.deepEqual(kept, ["src/app.js", "README.md"]);
  assert.throws(() => filesToPush(Array.from({ length: MAX_FILES + 1 }, (_, i) => f(`f${i}.txt`))), /more than/);
  assert.throws(() => filesToPush([f("big.bin", 51 * 1024 * 1024)]), /larger than 50 MB/);
});
