import { dockerClient } from "./docker.js";
import { dockerWorkspaces } from "./workspaces.js";
import { kubeWorkspaces } from "./kube-workspaces.js";
import { inClusterNamespace, kubeClient, kubeObjects } from "./kube.js";
import { createProxy } from "./proxy.js";
import { createApi } from "./api.js";

/**
 * continuum-workspaces: development servers for Continuum projects.
 *   PUBLIC_PORT    the editors (/w/<id>/…), behind Continuum's address
 *   INTERNAL_PORT  start / stop / delete / status, for continuum-api only
 * DRIVER=docker (local development) or kubernetes (the cloud: GKE, its own namespace).
 */
const env = process.env;
const log = logger(env.LOG_LEVEL ?? "info");
const IDLE_MS = Number(env.IDLE_MINUTES ?? 30) * 60_000;

const driver = env.DRIVER ?? "docker";
// The slimmer sandboxes, where this install has their images (WORKSPACE_IMAGE is "full", every tool)
const images = Object.fromEntries(
  [
    ["node", env.WORKSPACE_IMAGE_NODE],
    ["python", env.WORKSPACE_IMAGE_PYTHON],
    ["java", env.WORKSPACE_IMAGE_JAVA],
  ].filter(([, image]) => image),
);
let workspaces;
if (driver === "kubernetes") {
  // In the cloud: this pod's namespace, with the Role the Continuum Deploy add-on gives it
  const namespace = env.WORKSPACE_NAMESPACE ?? inClusterNamespace();
  if (!namespace || !env.WORKSPACE_IMAGE) {
    log.error({}, "DRIVER=kubernetes needs WORKSPACE_IMAGE and a namespace (WORKSPACE_NAMESPACE, or running in a cluster)");
    process.exit(1);
  }
  workspaces = kubeWorkspaces({
    objects: kubeObjects(kubeClient(), namespace),
    namespace,
    image: env.WORKSPACE_IMAGE,
    images,
    storageClass: env.WORKSPACE_STORAGE_CLASS ?? "standard-rwo",
    diskGb: Number(env.WORKSPACE_DISK_GB ?? 10),
  });
} else if (driver === "docker") {
  workspaces = dockerWorkspaces({
    docker: dockerClient({ socketPath: env.DOCKER_SOCKET ?? "/var/run/docker.sock" }),
    image: env.WORKSPACE_IMAGE ?? "continuum-workspace:dev",
    images,
    network: env.WORKSPACE_NETWORK ?? "docker_default",
  });
} else {
  log.error({ driver }, "DRIVER must be docker (local development) or kubernetes (the cloud)");
  process.exit(1);
}
const proxy = createProxy({ target: workspaces.target, log });
const api = createApi({ workspaces, proxy, log });

proxy.server.listen(Number(env.PUBLIC_PORT ?? 45176), () => log.info({ port: Number(env.PUBLIC_PORT ?? 45176) }, "editors (public)"));
api.listen(Number(env.INTERNAL_PORT ?? 45177), () => log.info({ port: Number(env.INTERNAL_PORT ?? 45177) }, "internal API"));

// Every minute: stop workspaces with no editor connected for IDLE_MINUTES (their code stays)
const timer = setInterval(async () => {
  try {
    for (const id of proxy.idle(await workspaces.running(), IDLE_MS)) {
      await workspaces.stop(id);
      proxy.forget(id);
      log.info({ id, idleMinutes: IDLE_MS / 60_000 }, "workspace stopped: not used");
    }
  } catch (e) {
    log.warn({ err: e.message }, "idle check failed");
  }
}, 60_000);

const shutdown = () => {
  clearInterval(timer);
  proxy.server.close();
  api.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/** JSON lines, like the other services (no secrets are ever logged here). */
function logger(level) {
  const order = ["debug", "info", "warn", "error"];
  const at = order.indexOf(level);
  const out = (lvl) => (obj, msg) => order.indexOf(lvl) >= at && console.log(JSON.stringify({ time: new Date().toISOString(), level: lvl, name: "continuum-workspaces", msg, ...obj }));
  return { debug: out("debug"), info: out("info"), warn: out("warn"), error: out("error") };
}
