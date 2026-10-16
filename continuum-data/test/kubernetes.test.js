import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { kubeStore, STORE } from "../src/runtime/kubeStore.js";
import { kubeRunner } from "../src/runtime/kubeRunner.js";
import { quietLog } from "./helpers.js";

/**
 * The cloud drivers (DATA_RUNTIME=kubernetes) against a fake Kubernetes API:
 * what they create, with which limits, and how a step's output and exit code
 * are followed. The fake keeps objects by path; a pod starts running when
 * created, and its log is whatever the test gives it.
 */
const NS = "continuum";
const IMAGE = "registry/runner@sha256:1";
const USER = "0123456789abcdef01234567";

function fakeKube({ forbid = [], logs = {}, ended = {} } = {}) {
  const objects = new Map();
  const calls = [];
  const kube = {
    namespace: NS,
    objects,
    calls,
    async call(method, path, body) {
      calls.push(`${method} ${path.split("?")[0]}`);
      const p = path.split("?")[0];
      if (method === "GET" && path.includes("?labelSelector=")) {
        const items = [...objects.entries()].filter(([k, o]) => k.startsWith(`${p}/`) && o.metadata.labels?.["continuum-data"] === "runner").map(([, o]) => o);
        return { status: 200, body: { items } };
      }
      if (method === "GET") return objects.has(p) ? { status: 200, body: objects.get(p) } : { status: 404, body: { message: "not found" } };
      if (method === "DELETE") return objects.delete(p) ? { status: 200, body: {} } : { status: 404, body: {} };
      if (forbid.some((f) => p.includes(f))) return { status: 403, body: { message: `forbidden: ${p}` } };
      const key = `${p}/${body.metadata.name}`;
      if (objects.has(key)) return { status: 409, body: {} };
      const obj = structuredClone(body);
      if (body.kind === "Pod") {
        const name = body.metadata.name;
        const container = body.spec.containers[0].name;
        obj.status = name in ended ? { phase: "Running", containerStatuses: [{ name: container, state: { terminated: ended[name] } }] } : { phase: "Running", conditions: [{ type: "Ready", status: "True" }], containerStatuses: [{ name: container, state: { running: {} } }] };
      }
      objects.set(key, obj);
      return { status: 201, body: obj };
    },
    async stream(path) {
      const name = path.split("/pods/")[1].split("/")[0];
      const next = logs[name]?.shift();
      const r = Readable.from(next?.lines ?? []);
      r.statusCode = 200;
      // When this part of the log ends, the container may have ended too
      r.on("end", () => {
        if (next?.exit !== undefined) {
          const pod = objects.get(`/api/v1/namespaces/${NS}/pods/${name}`);
          if (pod) pod.status.containerStatuses[0].state = { terminated: { exitCode: next.exit, reason: next.reason } };
        }
      });
      return r;
    },
  };
  return kube;
}

const pod = (kube, name) => kube.objects.get(`/api/v1/namespaces/${NS}/pods/${name}`);

test("the store: its network rules, token, disk, Service and pod are created once; then it is only checked", async () => {
  const kube = fakeKube();
  const store = kubeStore({ kube, image: IMAGE, diskGb: 20, log: quietLog, pollMs: 1 });
  const c = await store.ensure();
  assert.equal(c.url, `http://${STORE}:45192`);
  assert.match(c.token, /^[0-9a-f]{64}$/);

  const np = kube.objects.get(`/apis/networking.k8s.io/v1/namespaces/${NS}/networkpolicies/data-runner-no-network`);
  assert.deepEqual(np.spec.policyTypes, ["Ingress", "Egress"]);
  assert.equal(np.spec.egress, undefined, "no network at all");
  const egress = kube.objects.get(`/apis/networking.k8s.io/v1/namespaces/${NS}/networkpolicies/data-runner-egress`);
  const internet = egress.spec.egress.find((r) => r.to[0].ipBlock?.cidr === "0.0.0.0/0");
  assert.ok(internet.to[0].ipBlock.except.includes("10.0.0.0/8") && internet.to[0].ipBlock.except.includes("169.254.0.0/16"), "never the cluster or the metadata server");

  const pvc = kube.objects.get(`/api/v1/namespaces/${NS}/persistentvolumeclaims/${STORE}`);
  assert.equal(pvc.spec.resources.requests.storage, "20Gi");
  const p = pod(kube, STORE);
  assert.equal(p.spec.containers[0].image, IMAGE);
  assert.deepEqual(p.spec.containers[0].command, ["python", "-m", "cdata.store_server"]);
  assert.equal(p.spec.automountServiceAccountToken, false);
  assert.equal(p.spec.securityContext.runAsUser, 1000);
  assert.equal(p.spec.containers[0].securityContext.readOnlyRootFilesystem, true);

  // Within 30 s: no calls at all
  const before = kube.calls.length;
  assert.deepEqual(await store.ensure(), c);
  assert.equal(kube.calls.length, before);
  // After a failure: checked again, nothing created again
  store.stale();
  await store.ensure();
  assert.ok(!kube.calls.slice(before).some((x) => x.startsWith("POST")));
});

test("a new runner image restarts the store only while no step holds the disk", async () => {
  const kube = fakeKube();
  await kubeStore({ kube, image: IMAGE, log: quietLog, pollMs: 1 }).ensure();
  // A step is running: the store keeps its old image
  kube.objects.set(`/api/v1/namespaces/${NS}/pods/cdata-x`, { metadata: { name: "cdata-x", labels: { "continuum-data": "runner" } }, status: { phase: "Running" } });
  await kubeStore({ kube, image: "registry/runner@sha256:2", log: quietLog, pollMs: 1 }).ensure();
  assert.equal(pod(kube, STORE).spec.containers[0].image, IMAGE);
  // No step: the store starts again on the new image
  kube.objects.delete(`/api/v1/namespaces/${NS}/pods/cdata-x`);
  await kubeStore({ kube, image: "registry/runner@sha256:2", log: quietLog, pollMs: 1 }).ensure();
  assert.equal(pod(kube, STORE).spec.containers[0].image, "registry/runner@sha256:2");
});

test("without the rights to make network rules, the store says what's missing (and nothing runs without them)", async () => {
  const kube = fakeKube({ forbid: ["networkpolicies"] });
  await assert.rejects(kubeStore({ kube, image: IMAGE, log: quietLog, pollMs: 1 }).ensure(), (e) => e.code === "STORE_SETUP" && /clusterAccess/.test(e.message));
  assert.equal(pod(kube, STORE), undefined);
});

test("a step: a locked-down pod on the store's machine with only its user's folder; its output followed to the exit code, then removed", async () => {
  const name = "cdata-run1-0-1";
  const kube = fakeKube({ logs: { [name]: [{ lines: ['{"kind":"log","message":"Read 3 rows."}\n', '{"kind":"result","rows":3}\n'], exit: 0 }] } });
  const store = kubeStore({ kube, image: IMAGE, log: quietLog, pollMs: 1 });
  const runner = kubeRunner({ kube, store, image: IMAGE, cpu: "1", memory: "4Gi", log: quietLog, pollMs: 1 });
  const lines = [];
  let spec = null;
  const realCall = kube.call;
  kube.call = async (method, path, body) => {
    if (method === "POST" && body?.metadata?.name === name) spec = structuredClone(body);
    return realCall(method, path, body);
  };
  const code = await runner.run({ name, step: "s1", userId: USER, op: "ingest", params: { input: "raw/1" }, network: false, timeoutSec: 600 }, (l) => lines.push(l));
  assert.equal(code, 0);
  assert.deepEqual(lines, [{ kind: "log", message: "Read 3 rows." }, { kind: "result", rows: 3 }]);
  assert.equal(pod(kube, name), undefined, "removed when done");

  const c = spec.spec.containers[0];
  assert.deepEqual(c.command, ["cdata", "ingest"]);
  assert.deepEqual(JSON.parse(c.env.find((e) => e.name === "CDATA_PARAMS").value), { input: "raw/1" });
  assert.deepEqual(c.volumeMounts.find((m) => m.name === "store"), { name: "store", mountPath: "/store", subPath: USER });
  assert.equal(spec.metadata.labels["continuum-data-network"], "none");
  assert.equal(spec.spec.restartPolicy, "Never");
  assert.equal(spec.spec.activeDeadlineSeconds, 600);
  assert.equal(spec.spec.automountServiceAccountToken, false);
  assert.equal(c.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(c.securityContext.capabilities.drop, ["ALL"]);
  assert.equal(c.resources.limits.memory, "4Gi");
  const affinity = spec.spec.affinity.podAffinity.requiredDuringSchedulingIgnoredDuringExecution[0];
  assert.deepEqual([affinity.labelSelector.matchLabels, affinity.topologyKey], [{ "continuum-data": "store" }, "kubernetes.io/hostname"]);
});

test("downloads get the internet; a log that drops is followed again without repeating lines; running out of memory says so", async () => {
  const name = "cdata-run2-0-1";
  const kube = fakeKube({
    logs: {
      [name]: [
        { lines: ['{"kind":"progress","done":1}\n'] }, // the stream drops; the step still runs
        { lines: ['{"kind":"progress","done":1}\n', '{"kind":"progress","done":2}\n'], exit: 137, reason: "OOMKilled" },
      ],
    },
  });
  const store = kubeStore({ kube, image: IMAGE, log: quietLog, pollMs: 1 });
  const runner = kubeRunner({ kube, store, image: IMAGE, memory: "4Gi", log: quietLog, pollMs: 1 });
  let labels = null;
  const realCall = kube.call;
  kube.call = async (method, path, body) => {
    if (method === "POST" && body?.metadata?.name === name) labels = body.metadata.labels;
    return realCall(method, path, body);
  };
  const lines = [];
  const code = await runner.run({ name, step: "s1", userId: USER, op: "fetch", params: {}, network: true }, (l) => lines.push(l));
  assert.equal(labels["continuum-data-network"], "egress");
  assert.equal(code, 137);
  assert.deepEqual(lines, [{ kind: "progress", done: 1 }, { kind: "progress", done: 2 }, { kind: "log", message: "The step ran out of memory (4Gi)." }]);
});

test("a step stopped early (its signal) is removed", async () => {
  const name = "cdata-run3-0-1";
  const kube = fakeKube({ logs: { [name]: [] } });
  const store = kubeStore({ kube, image: IMAGE, log: quietLog, pollMs: 1 });
  const runner = kubeRunner({ kube, store, image: IMAGE, log: quietLog, pollMs: 5 });
  const controller = new AbortController();
  const run = runner.run({ name, step: "s1", userId: USER, op: "profile", params: {} }, () => {}, controller.signal);
  setTimeout(() => controller.abort(new Error("stopped")), 30);
  await assert.rejects(run, /stopped/);
  assert.equal(pod(kube, name), undefined);
});
