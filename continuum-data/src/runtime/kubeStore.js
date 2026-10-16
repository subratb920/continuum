import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { TemporaryJobError } from "../errors.js";
import { kubeMessage } from "./kube.js";

/**
 * The data store in the cloud (DATA_RUNTIME=kubernetes): what continuum-api
 * sets up in its own namespace, with the rights Continuum Deploy gives it
 * (clusterAccess ["pods"]):
 *
 * - disk "data-store" (a PersistentVolumeClaim): every user's folder;
 * - pod "data-store": the runner image serving that disk to continuum-api
 *   (cdata/store_server.py), which can't mount it itself; each step's pod
 *   mounts the same disk on the same machine (kubeRunner);
 * - Service "data-store" and Secret "data-store" (the store's token, made here);
 * - network rules: steps get no network, except downloads, which reach the
 *   internet only (never the cluster, the machine or Google's metadata server).
 *
 * ensure() makes each of them exist (only what's missing) and resolves with
 * { url, token } once the store answers.
 */
export const STORE = "data-store";
export const STORE_PORT = 45192;
export const STORE_LABEL = { "continuum-data": "store" };
export const RUNNER_LABEL = "continuum-data";
const NO_NETWORK = "data-runner-no-network";
const EGRESS = "data-runner-egress";
const CHECK_EVERY_MS = 30_000;

/** Private, link-local and shared ranges: the cluster, the machine and the metadata server. */
const NOT_INTERNET = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "127.0.0.0/8"];

export function kubeStore({ kube, image, diskGb = 50, log, readyTimeoutMs = 10 * 60_000, pollMs = 3000 }) {
  const ns = kube.namespace;
  const api = (kind, name = "") => {
    const base = kind === "networkpolicies" ? `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies` : `/api/v1/namespaces/${ns}/${kind}`;
    return name ? `${base}/${name}` : base;
  };
  let checkedAt = 0;
  let current = null; // { url, token }
  let pending = null;

  async function getOrCreate(kind, name, make) {
    const got = await kube.call("GET", api(kind, name));
    if (got.status === 200) return got.body;
    if (got.status !== 404) throw new TemporaryJobError("STORE_SETUP", `Couldn't read ${kind}/${name}: ${kubeMessage(got)}`);
    const made = await kube.call("POST", api(kind), make());
    if (made.status === 201 || made.status === 200) {
      log.info({ kind, name }, "data store: created");
      return made.body;
    }
    if (made.status === 409) return (await kube.call("GET", api(kind, name))).body; // made meanwhile (another copy of the API)
    if (made.status === 403) {
      throw new TemporaryJobError("STORE_SETUP", `This app may not create ${kind} here: ${kubeMessage(made)}. Continuum Deploy gives it these rights with clusterAccess ["pods"].`);
    }
    throw new TemporaryJobError("STORE_SETUP", `Couldn't create ${kind}/${name}: ${kubeMessage(made)}`);
  }

  const meta = (name, labels = STORE_LABEL) => ({ name, labels: { ...labels, "app.kubernetes.io/managed-by": "continuum-data" } });

  function storePod() {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: meta(STORE),
      spec: {
        restartPolicy: "Always",
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: "store",
            image,
            command: ["python", "-m", "cdata.store_server"],
            env: [
              { name: "CDATA_STORE_ROOT", value: "/data" },
              { name: "CDATA_STORE_PORT", value: String(STORE_PORT) },
              { name: "CDATA_STORE_TOKEN", valueFrom: { secretKeyRef: { name: STORE, key: "token" } } },
            ],
            ports: [{ containerPort: STORE_PORT }],
            readinessProbe: { httpGet: { path: "/health", port: STORE_PORT }, periodSeconds: 5 },
            resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "250m", memory: "512Mi" } },
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
            volumeMounts: [
              { name: "store", mountPath: "/data" },
              { name: "tmp", mountPath: "/tmp" },
            ],
          },
        ],
        volumes: [
          { name: "store", persistentVolumeClaim: { claimName: STORE } },
          { name: "tmp", emptyDir: { sizeLimit: "256Mi" } },
        ],
      },
    };
  }

  async function networkRules() {
    // No network at all (every step but downloads)
    await getOrCreate("networkpolicies", NO_NETWORK, () => ({
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(NO_NETWORK, {}),
      spec: { podSelector: { matchLabels: { [`${RUNNER_LABEL}-network`]: "none" } }, policyTypes: ["Ingress", "Egress"] },
    }));
    // Downloads: the internet and name lookups only
    await getOrCreate("networkpolicies", EGRESS, () => ({
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(EGRESS, {}),
      spec: {
        podSelector: { matchLabels: { [`${RUNNER_LABEL}-network`]: "egress" } },
        policyTypes: ["Ingress", "Egress"],
        egress: [
          {
            to: [
              { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } },
              { ipBlock: { cidr: "169.254.20.10/32" } }, // GKE's node-local DNS cache
            ],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 },
            ],
          },
          { to: [{ ipBlock: { cidr: "0.0.0.0/0", except: NOT_INTERNET } }] },
        ],
      },
    }));
  }

  async function token() {
    const secret = await getOrCreate("secrets", STORE, () => ({
      apiVersion: "v1",
      kind: "Secret",
      metadata: meta(STORE),
      type: "Opaque",
      data: { token: Buffer.from(randomBytes(32).toString("hex")).toString("base64") },
    }));
    return Buffer.from(secret.data.token, "base64").toString("utf8");
  }

  /** The store pod, (re)started when it is gone, failed, or on an older image while no step runs. */
  async function pod() {
    const got = await kube.call("GET", api("pods", STORE));
    if (got.status === 200) {
      const p = got.body;
      const done = p.metadata?.deletionTimestamp || ["Failed", "Succeeded"].includes(p.status?.phase);
      const old = p.spec?.containers?.[0]?.image !== image;
      if (!done && !old) return p;
      if (old && !done) {
        // A new image: only when no step holds the disk (they run on its machine)
        const steps = await kube.call("GET", `${api("pods")}?labelSelector=${encodeURIComponent(`${RUNNER_LABEL}=runner`)}`);
        if (steps.status !== 200 || steps.body.items.some((s) => !["Failed", "Succeeded"].includes(s.status?.phase))) return p;
      }
      log.info({ reason: old ? "new image" : p.status?.phase }, "data store: starting it again");
      await kube.call("DELETE", `${api("pods", STORE)}?gracePeriodSeconds=5`);
      for (let i = 0; i < 60 && (await kube.call("GET", api("pods", STORE))).status === 200; i++) await sleep(pollMs / 3);
    } else if (got.status !== 404) {
      throw new TemporaryJobError("STORE_SETUP", `Couldn't read the data store: ${kubeMessage(got)}`);
    }
    return getOrCreate("pods", STORE, storePod);
  }

  const ready = (p) => p?.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True");

  async function setUp() {
    await networkRules();
    const t = await token();
    await getOrCreate("persistentvolumeclaims", STORE, () => ({
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: meta(STORE),
      spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: `${diskGb}Gi` } } },
    }));
    await getOrCreate("services", STORE, () => ({
      apiVersion: "v1",
      kind: "Service",
      metadata: meta(STORE),
      spec: { selector: STORE_LABEL, ports: [{ port: STORE_PORT, targetPort: STORE_PORT }] },
    }));
    let p = await pod();
    const until = Date.now() + readyTimeoutMs;
    while (!ready(p)) {
      if (Date.now() > until) throw new TemporaryJobError("STORE_NOT_READY", "The data store didn't start in time; trying again shortly.");
      const waiting = p?.status?.containerStatuses?.[0]?.state?.waiting;
      if (waiting && /ImagePull|ErrImage|CreateContainerConfigError/.test(waiting.reason ?? "")) {
        throw new TemporaryJobError("STORE_NOT_READY", `The data store can't start: ${waiting.reason}${waiting.message ? ` (${waiting.message})` : ""}`);
      }
      await sleep(pollMs);
      p = (await kube.call("GET", api("pods", STORE))).body;
    }
    return { url: `http://${STORE}:${STORE_PORT}`, token: t };
  }

  return {
    /** { url, token } once the store answers; checked again every 30 s. */
    async ensure() {
      if (current && Date.now() - checkedAt < CHECK_EVERY_MS) return current;
      pending ??= setUp()
        .then((c) => {
          current = c;
          checkedAt = Date.now();
          return c;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    /** After a call to the store failed: look at it again on the next use. */
    stale() {
      checkedAt = 0;
    },
  };
}
