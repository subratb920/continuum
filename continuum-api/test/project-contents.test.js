import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ENTRIES, normalizeContents } from "../src/services/projectContents.js";

const now = new Date("2026-10-15T10:00:00Z");

test("contents: paths sorted, sizes summed, the folder kept", () => {
  const c = normalizeContents({ folder: "my-shop-app", entries: [["src/b.js", 20], ["package.json", 10], ["src/a.js", 5]] }, now);
  assert.deepEqual(c.entries.map((e) => e[0]), ["package.json", "src/a.js", "src/b.js"]);
  assert.equal(c.fileCount, 3);
  assert.equal(c.totalBytes, 35);
  assert.equal(c.folder, "my-shop-app");
  assert.equal(c.truncated, false);
  assert.equal(c.importedAt, now);
});

test("contents: dependencies, git, build output and .env files are left out; duplicates dropped", () => {
  const c = normalizeContents({
    folder: "x",
    entries: [["node_modules/a/index.js", 1], ["web/node_modules/b.js", 1], [".git/HEAD", 1], ["dist/app.js", 1], [".env", 1], ["api/.env.production", 1], ["src/env.js", 1], ["src/env.js", 1]],
  }, now);
  assert.deepEqual(c.entries, [["src/env.js", 1]]);
});

test("contents: at most 5000 files, marked as cut short", () => {
  const entries = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => [`f/${i}.txt`, 1]);
  const c = normalizeContents({ folder: "big", entries }, now);
  assert.equal(c.fileCount, MAX_ENTRIES);
  assert.equal(c.truncated, true);
});

test("contents: bad input is refused", () => {
  assert.throws(() => normalizeContents([], now), /must be an object/);
  assert.throws(() => normalizeContents({ entries: "x" }, now), /list of \[path, size\]/);
  assert.throws(() => normalizeContents({ entries: [["../etc/passwd", 1]] }, now), /Not a valid path/);
  assert.throws(() => normalizeContents({ entries: [[42, 1]] }, now), /\[path, size\]/);
  assert.equal(normalizeContents(undefined, now), null);
});

test("contents: Windows separators and negative sizes are tidied", () => {
  const c = normalizeContents({ folder: "w", entries: [["src\\main.py", -5], ["/README.md", 3.7]] }, now);
  assert.deepEqual(c.entries, [["README.md", 3], ["src/main.py", 0]]);
});
