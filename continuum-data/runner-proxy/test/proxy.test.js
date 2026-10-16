import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createProxy } from "../src/proxy.js";
import { demux } from "../src/docker.js";

const USER = "0123456789abcdef01234567";

function fakeDocker() {
  const calls = [];
  const containers = new Map();
  return {
    calls,
    containers,
    createContainer: async (name, spec) => (calls.push(["create", name]), containers.set(name, spec)),
    startContainer: async (name) => calls.push(["start", name]),
    removeContainer: async (name) => (calls.push(["remove", name]), containers.delete(name)),
    inspectContainer: async () => null,
    listContainers: async (label) => (calls.push(["list", label]), [{ Id: "old-try" }]),
    inspectNetwork: async () => null,
    createNetwork: async (name) => calls.push(["network", name]),
  };
}

async function serve(proxy) {
  await new Promise((r) => proxy.server.listen(0, r));
  const base = `http://127.0.0.1:${proxy.server.address().port}`;
  const post = (body, token = "secret") =>
    fetch(`${base}/runs`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, close: () => new Promise((r) => proxy.server.close(r)) };
}

const ok = { name: "cdata-abc-0-1", step: "abc-0", userId: USER, op: "ingest", params: { input: "raw/x" } };

test("a runner gets only its owner's folder, no network, no privileges", () => {
  const { containerSpec } = createProxy({ docker: fakeDocker(), token: "t", image: "runner:dev", storeHostPath: "/data" });
  const spec = containerSpec({ ...ok, network: false });
  assert.deepEqual(spec.HostConfig.Binds, [`/data/${USER}:/store`]);
  assert.equal(spec.HostConfig.NetworkMode, "none");
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(spec.HostConfig.CapDrop, ["ALL"]);
  assert.ok(spec.HostConfig.SecurityOpt.includes("no-new-privileges"));
  assert.equal(spec.User, "1000:1000");
  assert.equal(spec.Image, "runner:dev");
  assert.equal(containerSpec({ ...ok, op: "fetch", network: true }).HostConfig.NetworkMode, "continuum_data_egress");
});

test("starting a step removes earlier tries of it first", async () => {
  const docker = fakeDocker();
  const s = await serve(createProxy({ docker, token: "secret", image: "runner:dev", storeHostPath: "/data", log: {} }));
  try {
    const res = await s.post(ok);
    assert.equal(res.status, 201);
    assert.deepEqual(docker.calls.slice(0, 3), [["list", "continuum-data.step=abc-0"], ["remove", "old-try"], ["remove", ok.name]]);
    assert.deepEqual(docker.calls.slice(-2), [["create", ok.name], ["start", ok.name]]);
  } finally {
    await s.close();
  }
});

test("it refuses a wrong token, other images' names, unknown ops and bad users", async () => {
  const docker = fakeDocker();
  const s = await serve(createProxy({ docker, token: "secret", image: "runner:dev", storeHostPath: "/data", log: {} }));
  try {
    assert.equal((await s.post(ok, "wrong")).status, 401);
    assert.equal((await s.post({ ...ok, name: "continuum-api" })).status, 400);
    assert.equal((await s.post({ ...ok, op: "sh" })).status, 400);
    assert.equal((await s.post({ ...ok, userId: "../../etc" })).status, 400);
    assert.equal((await s.post({ ...ok, step: "a/b" })).status, 400);
    assert.equal((await fetch(`${s.base}/runs/continuum-mongo`, { method: "DELETE", headers: { Authorization: "Bearer secret" } })).status, 400);
    assert.equal(docker.calls.filter(([k]) => k === "create").length, 0);
  } finally {
    await s.close();
  }
});

test("Docker's log frames are split into stdout and stderr", async () => {
  const frame = (type, text) => {
    const body = Buffer.from(text);
    const head = Buffer.alloc(8);
    head[0] = type;
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const all = Buffer.concat([frame(1, '{"kind":"log"}\n'), frame(2, "warning\n")]);
  // split mid-header to check reassembly
  const out = [];
  for await (const c of demux(Readable.from([all.subarray(0, 5), all.subarray(5)]))) out.push([c.stream, c.data.toString()]);
  assert.deepEqual(out, [["stdout", '{"kind":"log"}\n'], ["stderr", "warning\n"]]);
});
