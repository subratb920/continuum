import { dockerClient } from "./docker.js";
import { createProxy } from "./proxy.js";

const env = process.env;
for (const name of ["PROXY_TOKEN", "STORE_HOST_PATH"]) {
  if (!env[name]) {
    console.error(`Missing required setting: ${name}`);
    process.exit(1);
  }
}

const log = {
  info: (o, m) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o, m) => console.log(JSON.stringify({ level: "warn", msg: m, ...o })),
  error: (o, m) => console.error(JSON.stringify({ level: "error", msg: m, ...o })),
};

const { server, sweep } = createProxy({
  docker: dockerClient({ socketPath: env.DOCKER_SOCKET || "/var/run/docker.sock" }),
  token: env.PROXY_TOKEN,
  image: env.RUNNER_IMAGE || "continuum-data-runner:dev",
  storeHostPath: env.STORE_HOST_PATH.replace(/\/+$/, ""),
  egressNetwork: env.EGRESS_NETWORK || "continuum_data_egress",
  limits: {
    cpus: Number(env.RUNNER_CPUS || 2),
    memoryBytes: Number(env.RUNNER_MEMORY_GB || 4) * 1024 ** 3,
  },
  log,
});

const port = Number(env.PORT || 45191);
server.listen(port, () => log.info({ port }, "continuum-data-runner-proxy listening"));
const timer = setInterval(() => sweep().catch((e) => log.error({ err: e.message }, "sweep failed")), 60_000);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
