import { randomBytes } from "node:crypto";
import { checkStart, clean, isWorkspaceId, probeEditor, SIZES, waitFor, WorkspaceError } from "./workspaces.js";

const LABEL = "continuum.workspace";
const UID = 1000; // the workspace image's user (openvscode-server)

/** A workspace's objects in its namespace: ws-<id> (pod, service), ws-<id>-home (disk), ws-<id>-env (secret). */
export const podName = (id) => `ws-${id}`;
export const diskName = (id) => `ws-${id}-home`;
export const secretName = (id) => `ws-${id}-env`;

/**
 * Workspaces on Kubernetes (GKE Autopilot, in the cloud), in this service's
 * own namespace. Per workspace: a disk (PersistentVolumeClaim) for
 * /home/workspace that stays until the workspace is deleted, and while it
 * runs a Secret (access token, GitHub sign-in), a Pod with its size's CPU and
 * memory, and a Service the proxy sends the editor's traffic to. Stopping
 * removes the Pod, Service and Secret; deleting also removes the disk.
 */
export function kubeWorkspaces({ objects, namespace, image, storageClass = "standard-rwo", diskGb = 10, basePath = "/w", probe = probeEditor, readyTimeoutMs = 45_000 }) {
  const tokens = new Map();
  const pathOf = (id, token) => `${basePath}/${id}/?tkn=${encodeURIComponent(token)}`;
  const host = (id) => `${podName(id)}.${namespace}.svc.cluster.local`;
  const labels = (id, extra = {}) => ({ [LABEL]: id, "app.kubernetes.io/part-of": "continuum-workspaces", "app.kubernetes.io/component": "workspace", ...extra });

  function check(id) {
    if (!isWorkspaceId(id)) throw new WorkspaceError(400, "Not a workspace id.");
  }

  async function status(id) {
    check(id);
    const pod = await objects.get("pods", podName(id));
    if (!pod || pod.metadata?.deletionTimestamp || ["Succeeded", "Failed"].includes(pod.status?.phase)) return { id, state: "stopped" };
    const ready = pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True");
    return { id, state: ready ? "running" : "starting", startedAt: pod.status?.startTime ?? null, size: pod.metadata?.labels?.["continuum.size"] ?? null };
  }

  async function start({ id, repo, githubToken, size = "standard", author = {} }) {
    const s = checkStart({ id, repo, githubToken, size });
    const accessToken = randomBytes(24).toString("base64url");
    const path = `${basePath}/${id}`;

    // A fresh start: whatever ran before goes (the disk stays)
    await removeRunning(id);
    await objects.create("pvcs", {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: { name: diskName(id), labels: labels(id) },
      spec: { accessModes: ["ReadWriteOnce"], storageClassName: storageClass, resources: { requests: { storage: `${diskGb}Gi` } } },
    });
    await objects.create("secrets", {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName(id), labels: labels(id) },
      type: "Opaque",
      stringData: { CONNECTION_TOKEN: accessToken, GITHUB_TOKEN: githubToken },
    });
    await objects.create("pods", {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: podName(id), labels: labels(id, { "continuum.size": size }) },
      spec: {
        restartPolicy: "Never",
        // The workspace never gets this service's Kubernetes rights
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        // Stop signals reach the editor (it isn't the first process)
        shareProcessNamespace: true,
        terminationGracePeriodSeconds: 10,
        securityContext: { runAsUser: UID, runAsGroup: UID, fsGroup: UID, runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
        containers: [
          {
            name: "workspace",
            image,
            ports: [{ containerPort: 3000, name: "editor" }],
            env: [
              { name: "BASE_PATH", value: path },
              { name: "GIT_REPO", value: repo },
              { name: "GIT_AUTHOR_NAME", value: clean(author.name) || "Continuum user" },
              { name: "GIT_AUTHOR_EMAIL", value: clean(author.email) || "user@continuum.local" },
              { name: "CONNECTION_TOKEN", valueFrom: { secretKeyRef: { name: secretName(id), key: "CONNECTION_TOKEN" } } },
              { name: "GITHUB_TOKEN", valueFrom: { secretKeyRef: { name: secretName(id), key: "GITHUB_TOKEN" } } },
            ],
            resources: {
              requests: { cpu: String(s.cpus), memory: `${s.memoryGb}Gi`, "ephemeral-storage": "2Gi" },
              limits: { cpu: String(s.cpus), memory: `${s.memoryGb}Gi`, "ephemeral-storage": "4Gi" },
            },
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
            readinessProbe: { tcpSocket: { port: 3000 }, periodSeconds: 3 },
            volumeMounts: [{ name: "home", mountPath: "/home/workspace" }],
          },
        ],
        volumes: [{ name: "home", persistentVolumeClaim: { claimName: diskName(id) } }],
      },
    });
    await objects.create("services", {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: podName(id), labels: labels(id) },
      spec: { selector: { [LABEL]: id, "app.kubernetes.io/component": "workspace" }, ports: [{ name: "editor", port: 3000, targetPort: 3000 }] },
    });
    tokens.set(id, accessToken);
    // Autopilot may add a machine and pull the image first: after the wait it's "starting", and the page retries
    const ready = await waitFor(() => probe(host(id), 3000), readyTimeoutMs, 1000);
    return { id, state: ready ? "running" : "starting", path: pathOf(id, accessToken) };
  }

  async function open(id) {
    check(id);
    const s = await status(id);
    const token = tokens.get(id);
    if (s.state === "stopped" || !token) return null;
    return { ...s, path: pathOf(id, token) };
  }

  async function removeRunning(id) {
    await objects.remove("services", podName(id));
    await objects.remove("pods", podName(id), 5);
    await objects.remove("secrets", secretName(id));
    // A pod being deleted keeps its name for a moment: wait until it's gone
    await waitFor(async () => !(await objects.get("pods", podName(id))), 30_000, 1000);
  }

  async function stop(id) {
    check(id);
    tokens.delete(id);
    await removeRunning(id);
    return { id, state: "stopped" };
  }

  async function remove(id) {
    check(id);
    tokens.delete(id);
    await removeRunning(id);
    await objects.remove("pvcs", diskName(id));
    return { id, state: "deleted" };
  }

  async function running() {
    const pods = await objects.list("pods", `${LABEL},app.kubernetes.io/component=workspace`);
    return pods.filter((p) => !p.metadata?.deletionTimestamp && ["Pending", "Running"].includes(p.status?.phase)).map((p) => p.metadata.labels[LABEL]);
  }

  const target = (id) => (isWorkspaceId(id) ? { host: host(id), port: 3000 } : null);

  return { status, start, open, stop, remove, running, target, sizes: SIZES };
}
