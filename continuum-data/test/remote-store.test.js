import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { remoteStorage } from "../src/storage/remote.js";

/**
 * The cloud's data store (runner-image cdata/store_server.py) and the engine's
 * remoteStorage, against each other: the store runs here with python3 on a
 * throwaway folder. Skipped without python3.
 */
const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;
const skip = python ? false : "python3 isn't installed";
const USER = "0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba98";
const TOKEN = "test-token";
let root;
let proc;
let url;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

before(async () => {
  if (skip) return;
  root = await mkdtemp(path.join(tmpdir(), "cdata-store-"));
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  proc = spawn(python, ["-m", "cdata.store_server"], {
    env: { ...process.env, PYTHONPATH: path.join(import.meta.dirname, "..", "runner-image"), CDATA_STORE_ROOT: root, CDATA_STORE_TOKEN: TOKEN, CDATA_STORE_PORT: String(port) },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${url}/health`).then((r) => r.ok, () => false)) return;
    await sleep(100);
  }
  throw new Error("the store didn't start");
});

after(async () => {
  if (skip) return;
  proc.kill();
  await rm(root, { recursive: true, force: true });
});

const storage = () => remoteStorage(async () => ({ url, token: TOKEN }));
const text = async (s) => {
  let out = "";
  for await (const c of s) out += c.toString();
  return out;
};

test("a user's files: written, read whole and by byte ranges, measured and removed", { skip }, async () => {
  const s = storage();
  await s.ensureUser(USER);
  assert.equal(await s.writeStream(USER, "uploads/u1/a.json", Readable.from([Buffer.from('{"rows":'), Buffer.from("3}")]), 1000), 10);
  assert.deepEqual(await s.readJson(USER, "uploads/u1/a.json"), { rows: 3 });
  assert.equal(await s.readJson(USER, "uploads/u1/missing.json"), null);
  assert.deepEqual(await s.stat(USER, "uploads/u1/a.json"), { size: 10, dir: false });
  assert.deepEqual(await s.stat(USER, "uploads"), { size: 10, dir: true });
  assert.equal(await s.stat(USER, "nothing/here"), null);
  assert.equal(await text(await s.readStream(USER, "uploads/u1/a.json")), '{"rows":3}');

  const buf = await s.fileBuffer(USER, "uploads/u1/a.json");
  assert.equal(buf.byteLength, 10);
  assert.equal(Buffer.from(await buf.slice(2, 6)).toString(), "rows");
  assert.equal(Buffer.from(await buf.slice(8)).toString(), "3}");
  assert.equal((await buf.slice(4, 4)).byteLength, 0);

  assert.equal(await s.usage(USER), 10);
  await s.remove(USER, "uploads/u1");
  assert.equal(await s.stat(USER, "uploads/u1/a.json"), null);
  assert.equal(await s.usage(USER), 0);
});

test("past its room a write stops with TOO_BIG and leaves nothing behind", { skip }, async () => {
  const s = storage();
  await s.ensureUser(USER);
  const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
  await assert.rejects(s.writeStream(USER, "uploads/big.bin", big, 1000), (e) => e.code === "TOO_BIG");
  assert.equal(await s.stat(USER, "uploads/big.bin"), null);
});

test("nothing outside the user's own folder: bad paths, other users' links, and no token", { skip }, async () => {
  const s = storage();
  for (const bad of ["../x", "/etc/passwd", "a/../../b", "a//b", ""]) {
    await assert.rejects(s.readJson(USER, bad), (e) => e.code === "BAD_PATH", bad);
  }
  await assert.rejects(s.readJson("not-a-user", "a.json"), (e) => e.code === "BAD_PATH");
  // A link that leads into another user's folder (or anywhere outside) is refused by the store
  await mkdir(path.join(root, OTHER), { recursive: true });
  await s.writeStream(OTHER, "secret.json", Readable.from([Buffer.from("{}")]), 100);
  await mkdir(path.join(root, USER), { recursive: true });
  await symlink(path.join(root, OTHER, "secret.json"), path.join(root, USER, "peek.json"));
  await assert.rejects(s.readJson(USER, "peek.json"), (e) => e.code === "BAD_PATH");

  const res = await fetch(`${url}/u/${USER}/usage`);
  assert.equal(res.status, 401);
  const wrong = await fetch(`${url}/u/${USER}/usage`, { headers: { Authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);
});

test("a store that isn't there is a temporary problem, and says to look at it again", { skip }, async () => {
  let told = 0;
  const s = remoteStorage(async () => ({ url: "http://127.0.0.1:9", token: TOKEN }), { unreachable: () => told++ });
  await assert.rejects(s.usage(USER), (e) => e.name === "TemporaryJobError" && e.code === "STORE_UNREACHABLE");
  assert.equal(told, 1);
});
