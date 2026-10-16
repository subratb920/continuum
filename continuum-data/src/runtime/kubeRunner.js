import { setTimeout as sleep } from "node:timers/promises";
import { TemporaryJobError } from "../errors.js";
import { kubeMessage } from "./kube.js";
import { RUNNER_LABEL, STORE, STORE_LABEL } from "./kubeStore.js";

/**
 * RunnerDriver in the cloud (DATA_RUNTIME=kubernetes): each step is a pod of
 * the runner image, with what the Docker proxy gives a container (runner
 * contract section 1): uid 1000, read-only root, /tmp of its own, no
 * privileges, the user's folder only as /store, and no network unless it is
 * a download (the store's network rules). It runs on the data store's machine,
 * as the disk can be mounted on one machine at a time.
 *
 * The same calls as proxyRunner: run() follows the pod's output lines and
 * resolves with its exit code.
 */
const STEP = "step";

export function kubeRunner({ kube, store, image, cpu = "1", memory = "4Gi", tmp = "2Gi", scheduleTimeoutMs = 15 * 60_000, pollMs = 1000, log }) {
  const ns = kube.namespace;
  const pods = `/api/v1/namespaces/${ns}/pods`;

  async function remove(name) {
    const r = await kube.call("DELETE", `${pods}/${name}?gracePeriodSeconds=0`);
    if (r.status !== 200 && r.status !== 202 && r.status !== 404) throw new TemporaryJobError("RUNNER_ERROR", `Couldn't remove step ${name}: ${kubeMessage(r)}`);
  }

  async function gone(name) {
    for (let i = 0; i < 60; i++) {
      if ((await kube.call("GET", `${pods}/${name}`)).status === 404) return;
      await sleep(pollMs);
    }
  }

  function podSpec({ name, step, userId, op, params, network, timeoutSec }) {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name,
        labels: { [RUNNER_LABEL]: "runner", [`${RUNNER_LABEL}-network`]: network ? "egress" : "none", [`${RUNNER_LABEL}-step`]: String(step).slice(0, 63), "app.kubernetes.io/managed-by": "continuum-data" },
      },
      spec: {
        restartPolicy: "Never",
        activeDeadlineSeconds: Math.max(60, Number(timeoutSec) || 7200),
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        terminationGracePeriodSeconds: 5,
        securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } },
        // On the store's machine: the disk is attached there
        affinity: { podAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{ labelSelector: { matchLabels: STORE_LABEL }, topologyKey: "kubernetes.io/hostname" }] } },
        containers: [
          {
            name: STEP,
            image,
            command: ["cdata", op],
            env: [{ name: "CDATA_PARAMS", value: JSON.stringify(params ?? {}) }],
            resources: { requests: { cpu, memory, "ephemeral-storage": tmp }, limits: { cpu, memory, "ephemeral-storage": tmp } },
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
            volumeMounts: [
              { name: "store", mountPath: "/store", subPath: String(userId) },
              { name: "tmp", mountPath: "/tmp" },
            ],
          },
        ],
        volumes: [
          { name: "store", persistentVolumeClaim: { claimName: STORE } },
          { name: "tmp", emptyDir: { sizeLimit: tmp } },
        ],
      },
    };
  }

  const stateOf = (p) => p?.status?.containerStatuses?.find((c) => c.name === STEP)?.state ?? {};

  /** Waits until the step's container has started (or ended); throws when it can't. */
  async function started(name, signal) {
    const until = Date.now() + scheduleTimeoutMs;
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const r = await kube.call("GET", `${pods}/${name}`);
      if (r.status === 404) throw new TemporaryJobError("RUNNER_LOST", "The step's pod was removed before it started.");
      const p = r.body;
      if (["Running", "Succeeded", "Failed"].includes(p?.status?.phase)) return;
      const waiting = stateOf(p).waiting;
      if (waiting && /ImagePull|ErrImage|CreateContainerConfigError|InvalidImageName/.test(waiting.reason ?? "")) {
        throw new TemporaryJobError("RUNNER_ERROR", `The step couldn't start: ${waiting.reason}${waiting.message ? ` (${waiting.message})` : ""}`);
      }
      if (Date.now() > until) throw new TemporaryJobError("RUNNER_ERROR", "The step waited too long for room in the cluster; trying again later.");
      await sleep(pollMs * 2);
    }
  }

  /** The exit code once the container has ended (137 when it ran out of memory); null: still running. */
  async function exitCode(name, onLine) {
    for (let i = 0; i < 120; i++) {
      const r = await kube.call("GET", `${pods}/${name}`);
      if (r.status === 404) throw new TemporaryJobError("RUNNER_LOST", "The step's pod was removed before it finished.");
      const state = stateOf(r.body);
      const ended = state.terminated;
      if (state.running && i >= 10) return null; // only its log stream dropped: follow it again
      if (ended) {
        if (ended.reason === "OOMKilled") onLine({ kind: "log", message: `The step ran out of memory (${memory}).` });
        if (r.body.status?.reason === "DeadlineExceeded") onLine({ kind: "log", message: "The step took longer than it may." });
        return ended.exitCode;
      }
      if (r.body.status?.phase === "Failed") return 1; // ended without a container state (e.g. its deadline)
      await sleep(pollMs);
    }
    return null;
  }

  return {
    async run(spec, onLine, signal) {
      const { name } = spec;
      await store.ensure();
      // A pod of the same step left by a crash goes first
      await remove(name);
      await gone(name);
      const made = await kube.call("POST", pods, podSpec(spec));
      if (made.status !== 201) throw new TemporaryJobError("RUNNER_ERROR", `Couldn't start the step: ${kubeMessage(made)}`);

      let stream = null;
      const abort = () => {
        stream?.destroy();
        remove(name).catch(() => {});
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await started(name, signal);
        // Its output, line by line; a log stream that drops is opened again and the lines already seen are skipped
        let seen = 0;
        let code = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          let n = 0;
          let buffer = "";
          const handle = (line) => {
            if (!line.trim()) return;
            n++;
            if (n <= seen) return;
            seen = n;
            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              msg = { kind: "log", message: line };
            }
            onLine(msg);
          };
          try {
            stream = await kube.stream(`${pods}/${name}/log?container=${STEP}&follow=true`);
            if (stream.statusCode !== 200) {
              stream.resume();
              throw new Error(`HTTP ${stream.statusCode}`);
            }
            for await (const chunk of stream) {
              buffer += chunk.toString("utf8");
              let i;
              while ((i = buffer.indexOf("\n")) >= 0) {
                handle(buffer.slice(0, i));
                buffer = buffer.slice(i + 1);
              }
            }
            handle(buffer);
          } catch (e) {
            if (signal?.aborted) throw signal.reason ?? e;
            log?.warn({ err: e, name }, "step log stream dropped; following again");
          }
          code = await exitCode(name, onLine);
          if (code !== null) break;
          if (signal?.aborted) throw signal.reason;
          await sleep(pollMs);
        }
        if (code === null) throw new TemporaryJobError("RUNNER_LOST", "The step's output ended before it finished.");
        return code;
      } catch (e) {
        // Stopped on purpose: its pod went because of that, so the reason is the stop
        if (signal?.aborted) throw signal.reason ?? e;
        throw e;
      } finally {
        signal?.removeEventListener("abort", abort);
        stream?.destroy();
        await remove(name).catch(() => {});
      }
    },
    remove,
  };
}
