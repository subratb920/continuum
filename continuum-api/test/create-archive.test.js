import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { tarGz } from "../src/create/tar.js";
import { withGitRepository, FIRST_COMMIT_MESSAGE } from "../src/create/git.js";
// The browser's own reader (continuum-bridge-spine), so writer and reader are tested together
import { readTar } from "../../continuum-bridge-spine/src/utils/deviceFolder.js";

const text = (d) => new TextDecoder().decode(d);

test("tar: the browser reader gets every file back, long paths included", () => {
  const long = `src/${"deep/".repeat(30)}file.txt`;
  const files = [["README.md", "# hi\n"], ["src/a.js", "x".repeat(1000)], [long, "long"], ["bin.dat", Buffer.from([0, 1, 2, 255])]];
  const out = readTar(new Uint8Array(gunzipSync(tarGz(files, "my-app"))));
  assert.deepEqual(out.map((f) => f.path), files.map(([p]) => p));
  assert.equal(text(out[1].data), "x".repeat(1000));
  assert.equal(text(out[2].data), "long");
  assert.deepEqual([...out[3].data], [0, 1, 2, 255]);
});

test("git: one commit on main; origin without credentials", async () => {
  const { files, sha } = await withGitRepository([["README.md", "# hi\n"], ["src/index.js", "console.log(1)\n"]], {
    author: { name: "dev", email: "dev@example.com" },
    remoteUrl: "https://github.com/someone/my-app.git",
  });
  assert.match(sha, /^[0-9a-f]{40}$/);
  const get = (p) => files.find(([x]) => x === p)?.[1];
  assert.equal(String(get(".git/HEAD")).trim(), "ref: refs/heads/main");
  assert.equal(String(get(".git/refs/heads/main")).trim(), sha);
  const config = String(get(".git/config"));
  assert.match(config, /url = https:\/\/github\.com\/someone\/my-app\.git/);
  assert.ok(!/@github\.com|token|password/i.test(config));
  assert.ok(files.some(([p]) => p.startsWith(".git/objects/")));
  assert.equal(FIRST_COMMIT_MESSAGE, "Initial commit from Continuum");
});

test("put on GitHub: the browser's .tar.gz (long paths, binary, unicode) is read back byte for byte", async () => {
  const { tarGzOf } = await import("../../continuum-bridge-spine/src/utils/tarWriter.js");
  const { readTarGz } = await import("../src/create/tar.js");
  const long = "src/" + "very-long-folder-name/".repeat(6) + "deep-file.js";
  const bin = new Uint8Array(3000).map((_, i) => i % 256);
  const files = [
    { path: "package.json", file: new Blob(['{"name":"demo"}']) },
    { path: long, file: new Blob(["export const x = 1;\n"]) },
    { path: "assets/logo.png", file: new Blob([bin]) },
    { path: "README.md", file: new Blob(["# Demo — ünïcode ✓\n"]) },
  ];
  const back = readTarGz(Buffer.from(await (await tarGzOf(files)).arrayBuffer()), 10 * 1024 * 1024);
  assert.equal(back.length, files.length);
  for (const f of files) {
    const got = back.find((b) => b.path === f.path);
    assert.ok(got, f.path);
    assert.deepEqual(new Uint8Array(got.data), new Uint8Array(await f.file.arrayBuffer()), f.path);
  }
});

test("phones are phones, whatever their browser can do (Chrome on Android picks folders too)", async () => {
  const { isMobileDevice } = await import("../../continuum-bridge-spine/src/utils/deviceFolder.js");
  const android = "Mozilla/5.0 (Linux; Android 13; LXX504) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  assert.equal(isMobileDevice({ userAgent: android }), true);
  assert.equal(isMobileDevice({ userAgent: iphone }), true);
  assert.equal(isMobileDevice({ userAgent: ipad, maxTouchPoints: 5 }), true, "iPadOS says Macintosh");
  assert.equal(isMobileDevice({ userAgent: mac, maxTouchPoints: 0 }), false);
  assert.equal(isMobileDevice({ userAgent: mac, userAgentData: { mobile: true } }), true);
  assert.equal(isMobileDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", userAgentData: { mobile: false } }), false);
});
