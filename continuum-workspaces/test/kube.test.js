import { test } from "node:test";
import assert from "node:assert/strict";
import { kubeWorkspaces, podName, diskName, secretName } from "../src/kube-workspaces.js";
import { kubeObjects } from "../src/kube.js";

const ID = "b".repeat(24);

/** A pretend namespace: objects by kind and name; pods become Ready when asked */
function fakeObjects() {
  const store = { pods: new Map(), services: new Map(), secrets: new Map(), pvcs: new Map() };
  const calls = [];
  return {
    store,
    calls,
    create: async (kind, obj) => {
      calls.push(`create ${kind} ${obj.metadata.name}`);
      if (store[kind].has(obj.metadata.name)) return null;
      store[kind].set(obj.metadata.name, structuredClone(obj));
      if (kind === "pods") store.pods.get(obj.metadata.name).status = { phase: "Pending" };
      return obj;
    },
    get: async (kind, name) => store[kind].get(name) ?? null,
    remove: async (kind, name) => (calls.push(`delete ${kind} ${name}`), store[kind].delete(name), null),
    list: async (kind) => [...store[kind].values()],
    ready: (name) => (store.pods.get(name).status = { phase: "Running", conditions: [{ type: "Ready", status: "True" }] }),
  };
}

const make = (objects, extra = {}) => kubeWorkspaces({ objects, namespace: "continuum-workspaces", image: "reg/ws:1", probe: async () => true, readyTimeoutMs: 100, ...extra });

test("kubernetes: a disk, a secret, a pod with the size and no Kubernetes rights, and a service", async () => {
  const o = fakeObjects();
  const ws = make(o);
  const started = await ws.start({ id: ID, repo: "octo/app", githubToken: "ghtok", size: "large", author: { name: "Octo", email: "o@c.at" } });
  assert.match(started.path, new RegExp(`^/w/${ID}/\\?tkn=`));
  assert.equal(o.store.pvcs.get(diskName(ID)).spec.resources.requests.storage, "10Gi");
  assert.equal(o.store.secrets.get(secretName(ID)).stringData.GITHUB_TOKEN, "ghtok", "the sign-in lives in the secret");
  const pod = o.store.pods.get(podName(ID));
  const c = pod.spec.containers[0];
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.securityContext.runAsNonRoot, true);
  assert.deepEqual(c.securityContext.capabilities.drop, ["ALL"]);
  assert.equal(c.resources.limits.cpu, "4");
  assert.equal(c.resources.limits.memory, "8Gi");
  assert.ok(!JSON.stringify(c.env).includes("ghtok"), "the pod spec only refers to the secret");
  assert.equal(c.volumeMounts[0].mountPath, "/home/workspace");
  assert.equal(o.store.services.get(podName(ID)).spec.ports[0].port, 3000);
  assert.deepEqual(ws.target(ID), { host: `ws-${ID}.continuum-workspaces.svc.cluster.local`, port: 3000 });
});

test("kubernetes: starting → running follows the pod; stop keeps the disk; delete removes it", async () => {
  const o = fakeObjects();
  const ws = make(o);
  await ws.start({ id: ID, repo: "o/r", githubToken: "t" });
  assert.equal((await ws.status(ID)).state, "starting");
  assert.deepEqual(await ws.running(), [ID]);
  o.ready(podName(ID));
  assert.equal((await ws.status(ID)).state, "running");
  assert.ok((await ws.open(ID)).path.includes("tkn="));
  await ws.stop(ID);
  assert.equal((await ws.status(ID)).state, "stopped");
  assert.equal(await ws.open(ID), null);
  assert.ok(o.store.pvcs.has(diskName(ID)), "the code stays");
  assert.ok(!o.store.secrets.has(secretName(ID)), "the sign-in goes with the pod");
  await ws.remove(ID);
  assert.ok(!o.store.pvcs.has(diskName(ID)));
});

test("kubernetes: a restart replaces the pod and secret (new access token), the disk is reused", async () => {
  const o = fakeObjects();
  const ws = make(o);
  const a = await ws.start({ id: ID, repo: "o/r", githubToken: "t" });
  const b = await ws.start({ id: ID, repo: "o/r", githubToken: "t" });
  assert.notEqual(a.path, b.path);
  assert.equal(o.calls.filter((c) => c === `create pvcs ${diskName(ID)}`).length, 2, "asked twice, kept once (409)");
  assert.ok(o.calls.includes(`delete pods ${podName(ID)}`));
  await assert.rejects(ws.start({ id: "x", repo: "o/r", githubToken: "t" }), /workspace id/);
});

test("kubernetes client paths: namespaced, 409 on create and 404 on get/delete are fine", async () => {
  const seen = [];
  const kube = {
    call: async (method, path) => {
      seen.push(`${method} ${path}`);
      if (method === "POST") throw Object.assign(new Error("exists"), { status: 409 });
      if (method === "GET" && path.endsWith("/nope")) throw Object.assign(new Error("not found"), { status: 404 });
      if (method === "DELETE") throw Object.assign(new Error("not found"), { status: 404 });
      return { items: [{ metadata: { name: "a" } }] };
    },
  };
  const o = kubeObjects(kube, "ns1");
  assert.equal(await o.create("pods", { metadata: { name: "p" } }), null);
  assert.equal(await o.get("secrets", "nope"), null);
  assert.equal(await o.remove("pods", "p", 5), null);
  assert.equal((await o.list("pods", "continuum.workspace")).length, 1);
  assert.deepEqual(seen, [
    "POST /api/v1/namespaces/ns1/pods",
    "GET /api/v1/namespaces/ns1/secrets/nope",
    "DELETE /api/v1/namespaces/ns1/pods/p?gracePeriodSeconds=5",
    "GET /api/v1/namespaces/ns1/pods?labelSelector=continuum.workspace",
  ]);
});
