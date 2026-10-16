import { request } from "node:http";

/**
 * A small client for the Docker Engine API over its socket (the pattern of
 * continuum-brain's docker-client.ts). Only what runner containers need.
 */
export class DockerError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "DockerError";
    this.status = status;
  }
}

export function dockerClient({ socketPath = "/var/run/docker.sock", version = "v1.43" } = {}) {
  function raw(method, path, body, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = request(
        { socketPath, method, path: `/${version}${path}`, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} },
        resolve,
      );
      req.on("error", (e) => reject(new DockerError(0, `Docker isn't reachable: ${e.message}`)));
      if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out")));
      if (data) req.write(data);
      req.end();
    });
  }

  async function call(method, path, body, timeoutMs) {
    const res = await raw(method, path, body, timeoutMs);
    const chunks = [];
    for await (const c of res) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.statusCode >= 400) throw new DockerError(res.statusCode, json?.message ?? `Docker answered ${res.statusCode}`);
    return json;
  }

  const ignore = (...codes) => (e) => (e instanceof DockerError && codes.includes(e.status) ? null : Promise.reject(e));
  const n = encodeURIComponent;

  return {
    createContainer: (name, spec) => call("POST", `/containers/create?name=${n(name)}`, spec),
    startContainer: (name) => call("POST", `/containers/${n(name)}/start`).catch(ignore(304)),
    removeContainer: (name) => call("DELETE", `/containers/${n(name)}?force=true`).catch(ignore(404)),
    inspectContainer: (name) => call("GET", `/containers/${n(name)}/json`).catch(ignore(404)),
    /** Waits for the container to stop; no timeout (a step may take hours). */
    waitContainer: (name) => call("POST", `/containers/${n(name)}/wait`, undefined, 0),
    listContainers: (label) => call("GET", `/containers/json?all=true&filters=${n(JSON.stringify({ label: [label] }))}`),
    inspectNetwork: (name) => call("GET", `/networks/${n(name)}`).catch(ignore(404)),
    createNetwork: (name, labels) => call("POST", "/networks/create", { Name: name, Driver: "bridge", Labels: labels }),
    /** The container's output, as Docker's multiplexed stream (follows until it stops). */
    logs: (name) => raw("GET", `/containers/${n(name)}/logs?follow=true&stdout=true&stderr=true`, undefined, 0),
  };
}

/**
 * Splits Docker's multiplexed log stream (8-byte frame headers: stream type,
 * then the payload size) into stdout and stderr chunks.
 */
export async function* demux(stream) {
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const size = buf.readUInt32BE(4);
      if (buf.length < 8 + size) break;
      yield { stream: buf[0] === 2 ? "stderr" : "stdout", data: buf.subarray(8, 8 + size) };
      buf = buf.subarray(8 + size);
    }
  }
}
