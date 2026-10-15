import { request } from "node:http";

/**
 * A small client for the Docker Engine API over its socket (local development
 * only: whoever holds the socket controls Docker). Only what workspaces need:
 * volumes and containers, found by their labels.
 */
export class DockerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function dockerClient({ socketPath = "/var/run/docker.sock", requestImpl = request } = {}) {
  function call(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = requestImpl(
        { socketPath, method, path: `/v1.43${path}`, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            if (res.statusCode >= 400) reject(new DockerError(res.statusCode, json?.message ?? `Docker answered ${res.statusCode}`));
            else resolve(json);
          });
        },
      );
      req.on("error", (e) => reject(new DockerError(0, `Docker isn't reachable: ${e.message}`)));
      req.setTimeout(30_000, () => req.destroy(new Error("timed out")));
      if (data) req.write(data);
      req.end();
    });
  }
  const q = (o) => new URLSearchParams(o).toString();
  return {
    createVolume: (name, labels) => call("POST", "/volumes/create", { Name: name, Labels: labels }),
    removeVolume: (name) => call("DELETE", `/volumes/${encodeURIComponent(name)}`).catch(ignore(404)),
    createContainer: (name, spec) => call("POST", `/containers/create?${q({ name })}`, spec),
    startContainer: (name) => call("POST", `/containers/${encodeURIComponent(name)}/start`).catch(ignore(304)),
    stopContainer: (name) => call("POST", `/containers/${encodeURIComponent(name)}/stop?t=10`).catch(ignore(304, 404)),
    removeContainer: (name) => call("DELETE", `/containers/${encodeURIComponent(name)}?force=true`).catch(ignore(404)),
    inspectContainer: (name) => call("GET", `/containers/${encodeURIComponent(name)}/json`).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    listContainers: (label) => call("GET", `/containers/json?${q({ all: "true", filters: JSON.stringify({ label: [label] }) })}`),
  };
}

const ignore =
  (...codes) =>
  (e) =>
    codes.includes(e.status) ? null : Promise.reject(e);
