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
