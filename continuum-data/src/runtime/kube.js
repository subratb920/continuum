import { readFileSync } from "node:fs";
import { request } from "node:https";

/**
 * A small client for the Kubernetes API from inside the cluster (as
 * continuum-brain's): the pod's own ServiceAccount (its token, the cluster's
 * CA, its namespace). Continuum Deploy gives continuum-api that account with
 * clusterAccess ["pods"]: rights in its own namespace only. No client library.
 */
const SA = "/var/run/secrets/kubernetes.io/serviceaccount";

export function inClusterKube(env = process.env) {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = Number(env.KUBERNETES_SERVICE_PORT ?? 443);
  if (!host) throw new Error("Not inside a Kubernetes cluster (KUBERNETES_SERVICE_HOST isn't set).");
  const read = (f) => readFileSync(`${SA}/${f}`, "utf8").trim();
  let namespace;
  let ca;
  try {
    namespace = read("namespace");
    ca = read("ca.crt");
    read("token");
  } catch {
    throw new Error('This pod has no ServiceAccount token: the app hosting continuum-data needs cluster access (clusterAccess: ["pods"]).');
  }

  function open(method, path, body, { timeout = 20_000, contentType = "application/json" } = {}) {
    // The token is read each time: Kubernetes rotates it
    const token = read("token");
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host,
          port,
          path,
          method,
          ca,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(data ? { "Content-Type": contentType, "Content-Length": data.length } : {}) },
          timeout,
        },
        resolve,
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  return {
    namespace,
    /** { status, body }; status 0: the API wasn't reachable. */
    async call(method, path, body, opts) {
      let res;
      try {
        res = await open(method, path, body, opts);
      } catch {
        return { status: 0, body: null };
      }
      const chunks = [];
      for await (const c of res) chunks.push(c);
      const text = Buffer.concat(chunks).toString("utf8");
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // not JSON: kept as text
      }
      return { status: res.statusCode ?? 0, body: parsed };
    },
    /** A response to read as it comes (a pod's log with follow=true); destroy it to stop. */
    stream: (path) => open("GET", path, undefined, { timeout: 0 }),
  };
}

/** What a failed call said, for an error message. */
export const kubeMessage = (r) => (typeof r.body === "object" && r.body?.message ? r.body.message : r.status === 0 ? "the cluster's API wasn't reachable" : `HTTP ${r.status}`);
