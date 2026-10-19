import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { dockerWorkspaces, containerName, volumeName, SIZES } from "../src/workspaces.js";
import { createProxy } from "../src/proxy.js";
import { createApi } from "../src/api.js";

const ID = "a".repeat(24);

/** A pretend Docker: records calls, keeps containers in a map */
function fakeDocker() {
  const calls = [];
  const containers = new Map();
  const volumes = new Set();
  return {
    calls,
    containers,
    volumes,
    createVolume: async (name) => (calls.push(["createVolume", name]), volumes.add(name)),
    removeVolume: async (name) => (calls.push(["removeVolume", name]), volumes.delete(name)),
    createContainer: async (name, spec) => (calls.push(["createContainer", name]), containers.set(name, { spec, running: false })),
    startContainer: async (name) => (calls.push(["startContainer", name]), (containers.get(name).running = true)),
    stopContainer: async (name) => (calls.push(["stopContainer", name]), containers.has(name) && (containers.get(name).running = false)),
    removeContainer: async (name) => (calls.push(["removeContainer", name]), containers.delete(name)),
    inspectContainer: async (name) => {
      const c = containers.get(name);
      return c ? { State: { Running: c.running, StartedAt: "2026-10-16T10:00:00Z" }, Config: { Labels: c.spec.Labels } } : null;
    },
    listContainers: async () => [...containers.entries()].map(([, c]) => ({ State: c.running ? "running" : "exited", Labels: c.spec.Labels })),
  };
}

test("start: one container with the size's limits, its own volume, no extra rights; the access token is new each time", async () => {
  const docker = fakeDocker();
  const ws = dockerWorkspaces({ docker, image: "continuum-workspace:dev", network: "docker_default", probe: async () => true });
  const a = await ws.start({ id: ID, repo: "octo/app", githubToken: "ghtok", size: "large", author: { name: "Octo\nCat", email: "o@c.at" } });
  assert.match(a.path, new RegExp(`^/w/${ID}/\\?tkn=[A-Za-z0-9_-]{32}$`));
  const c = docker.containers.get(containerName(ID));
  assert.equal(c.spec.HostConfig.NanoCpus, SIZES.large.cpus * 1e9);
  assert.equal(c.spec.HostConfig.Memory, 8 * 1024 ** 3);
  assert.deepEqual(c.spec.HostConfig.CapDrop, ["ALL"]);
  assert.ok(c.spec.HostConfig.SecurityOpt.includes("no-new-privileges"));
  assert.equal(c.spec.HostConfig.Mounts[0].Source, volumeName(ID));
  assert.ok(c.spec.Env.includes("GIT_AUTHOR_NAME=OctoCat"), "no line breaks in git settings");
  assert.ok(c.spec.Env.includes("BASE_PATH=/w/" + ID));
  const b = await ws.start({ id: ID, repo: "octo/app", githubToken: "ghtok" });
  assert.notEqual(a.path, b.path, "a restart gets a new access token");
  assert.equal(docker.containers.get(containerName(ID)).spec.Labels["continuum.size"], "standard", "standard by default");
});

test("start: refuses bad ids, repositories, sizes and a missing GitHub sign-in", async () => {
  const ws = dockerWorkspaces({ docker: fakeDocker(), image: "i", network: "n", probe: async () => true });
  await assert.rejects(ws.start({ id: "../x", repo: "o/r", githubToken: "t" }), /workspace id/);
  await assert.rejects(ws.start({ id: ID, repo: "o/r; rm -rf /", githubToken: "t" }), /owner\/name/);
  await assert.rejects(ws.start({ id: ID, repo: "o/r", githubToken: "t", size: "huge" }), /small, standard or large/);
  await assert.rejects(ws.start({ id: ID, repo: "o/r" }), /GitHub sign-in/);
});

test("sandboxes: full is the service's image; the others run their own image only where this install has it", async () => {
  const docker = fakeDocker();
  const ws = dockerWorkspaces({ docker, image: "full:dev", images: { node: "node:dev" }, network: "n", probe: async () => true });
  assert.deepEqual(ws.sandboxes, ["full", "node"]);
  await ws.start({ id: ID, repo: "me/shop", githubToken: "t", sandbox: "node" });
  assert.equal(docker.containers.get(containerName(ID)).spec.Image, "node:dev");
  assert.equal((await ws.status(ID)).sandbox, "node");
  await ws.start({ id: ID, repo: "me/shop", githubToken: "t" });
  assert.equal(docker.containers.get(containerName(ID)).spec.Image, "full:dev", "no sandbox: full");
  await assert.rejects(ws.start({ id: ID, repo: "me/shop", githubToken: "t", sandbox: "java" }), /java sandbox isn't available/);
  await assert.rejects(ws.start({ id: ID, repo: "me/shop", githubToken: "t", sandbox: "rust" }), /rust sandbox isn't available/);
});

test("stop keeps the volume (the code); delete removes both", async () => {
  const docker = fakeDocker();
  const ws = dockerWorkspaces({ docker, image: "i", network: "n", probe: async () => true });
  await ws.start({ id: ID, repo: "o/r", githubToken: "t" });
  assert.deepEqual(await ws.running(), [ID]);
  await ws.stop(ID);
  assert.equal((await ws.status(ID)).state, "stopped");
  assert.ok(docker.volumes.has(volumeName(ID)));
  await ws.remove(ID);
  assert.ok(!docker.volumes.has(volumeName(ID)));
});

/** A pretend editor: answers HTTP and accepts a WebSocket-style upgrade that echoes */
function fakeEditor() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    res.end(`editor:${req.url}`);
  });
  server.on("upgrade", (req, socket) => {
    seen.push(`upgrade:${req.url}`);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
  });
  return { server, seen };
}

const listen = (s) => new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(s.address().port)));
const get = (port, path) =>
  new Promise((ok, ko) => request({ host: "127.0.0.1", port, path }, (r) => {
    let b = "";
    r.on("data", (c) => (b += c));
    r.on("end", () => ok({ status: r.statusCode, body: b, location: r.headers.location }));
  }).on("error", ko).end());

test("proxy: /w/<id>/… reaches that workspace's editor; unknown paths don't; live connections are counted for the idle stop", async () => {
  const editor = fakeEditor();
  const editorPort = await listen(editor.server);
  let clock = 1_000_000;
  const proxy = createProxy({ target: (id) => (id === ID ? { host: "127.0.0.1", port: editorPort } : null), now: () => clock });
  const port = await listen(proxy.server);
  try {
    assert.equal((await get(port, `/w/${ID}/static/x.js?tkn=abc`)).body, `editor:/w/${ID}/static/x.js?tkn=abc`);
    assert.equal((await get(port, `/w/${ID}`)).status, 308);
    assert.equal((await get(port, `/w/${"b".repeat(24)}/`)).status, 404);
    assert.equal((await get(port, "/etc/passwd")).status, 404);

    // A live connection: echoed through; while open, never idle
    const sock = connect(port, "127.0.0.1");
    await new Promise((ok) => sock.on("connect", ok));
    sock.write(`GET /w/${ID}/?reconnection=false HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    let got = "";
    sock.on("data", (d) => (got += d));
    await new Promise((ok) => setTimeout(ok, 100));
    sock.write("ping");
    await new Promise((ok) => setTimeout(ok, 100));
    assert.match(got, /101 Switching Protocols/);
    assert.match(got, /ping$/);
    clock += 60 * 60_000;
    assert.deepEqual(proxy.idle([ID], 30 * 60_000), [], "an open editor is never idle");
    sock.destroy();
    await new Promise((ok) => setTimeout(ok, 100));
    assert.deepEqual(proxy.idle([ID], 30 * 60_000), [], "just closed: counts from now");
    clock += 31 * 60_000;
    assert.deepEqual(proxy.idle([ID], 30 * 60_000), [ID], "30 minutes without an editor: idle");
    // A running workspace the proxy hasn't seen (e.g. after a restart): counted from now
    assert.deepEqual(proxy.idle(["c".repeat(24)], 30 * 60_000), []);
  } finally {
    for (const s of [proxy.server, editor.server]) {
      s.closeAllConnections();
      s.close();
    }
  }
});

test("internal API: start, status, stop and delete; bad input is a clear 4xx", async () => {
  const docker = fakeDocker();
  const ws = dockerWorkspaces({ docker, image: "i", network: "n", probe: async () => true });
  const proxy = createProxy({ target: ws.target });
  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const api = createApi({ workspaces: ws, proxy, log: quiet });
  const port = await listen(api);
  const call = (method, path, body) =>
    new Promise((ok, ko) => {
      const data = body ? JSON.stringify(body) : null;
      const r = request({ host: "127.0.0.1", port, method, path, headers: data ? { "Content-Type": "application/json" } : {} }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => ok({ status: res.statusCode, body: JSON.parse(b) }));
      });
      r.on("error", ko);
      if (data) r.write(data);
      r.end();
    });
  try {
    const started = await call("POST", `/internal/workspaces/${ID}/start`, { repo: "octo/app", githubToken: "ghtok", size: "small" });
    assert.equal(started.status, 202);
    assert.ok(!JSON.stringify(started.body).includes("ghtok"), "the GitHub token never comes back");
    assert.equal((await call("GET", `/internal/workspaces/${ID}`)).body.state, "running");
    const opened = await call("POST", `/internal/workspaces/${ID}/open`);
    assert.equal(opened.body.path, started.body.path, "a running workspace opens with its current access token");
    assert.equal((await call("POST", `/internal/workspaces/${ID}/stop`)).body.state, "stopped");
    assert.equal((await call("POST", `/internal/workspaces/${ID}/open`)).status, 409, "stopped: nothing to open (start it)");
    assert.equal((await call("DELETE", `/internal/workspaces/${ID}`)).body.state, "deleted");
    assert.equal((await call("POST", `/internal/workspaces/nope/start`, {})).status, 400);
    assert.equal((await call("PUT", `/internal/workspaces/${ID}`)).status, 405);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

test("start: answers once the editor is up (running), or after the wait as starting", async () => {
  let up = 0;
  const ws = dockerWorkspaces({ docker: fakeDocker(), image: "i", network: "n", probe: async () => ++up >= 3, readyTimeoutMs: 5000 });
  assert.equal((await ws.start({ id: ID, repo: "o/r", githubToken: "t" })).state, "running");
  assert.equal(up, 3);
  const slow = dockerWorkspaces({ docker: fakeDocker(), image: "i", network: "n", probe: async () => false, readyTimeoutMs: 600 });
  assert.equal((await slow.start({ id: ID, repo: "o/r", githubToken: "t" })).state, "starting");
});
