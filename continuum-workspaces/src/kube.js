import { request } from "node:https";
import { readFileSync } from "node:fs";

/**
 * A small client for the Kubernetes API from inside the cluster: the pod's
 * own service-account token (re-read for each call, as Kubernetes rotates it)
 * and the cluster's CA. No stored key; what it may do is set by the Role the
 * Continuum Deploy add-on gives it (its own namespace only).
 */
const SA = "/var/run/secrets/kubernetes.io/serviceaccount";

export class KubeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function inClusterNamespace() {
  try {
    return readFileSync(`${SA}/namespace`, "utf8").trim();
  } catch {
    return null;
  }
}

export function kubeClient({ host = process.env.KUBERNETES_SERVICE_HOST, port = process.env.KUBERNETES_SERVICE_PORT ?? "443", tokenPath = `${SA}/token`, caPath = `${SA}/ca.crt`, requestImpl = request } = {}) {
  const ca = (() => {
    try {
      return readFileSync(caPath);
    } catch {
      return undefined;
    }
  })();

  function call(method, path, body) {
    return new Promise((resolve, reject) => {
      let token;
      try {
        token = readFileSync(tokenPath, "utf8").trim();
      } catch {
        return reject(new KubeError(0, "No service-account token: not running in a cluster."));
      }
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = requestImpl(
        {
          host,
          port,
          method,
          path,
          ca,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            let json = null;
            try {
              json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
            } catch {
              json = null;
            }
            if (res.statusCode >= 400) reject(new KubeError(res.statusCode, json?.message ?? `Kubernetes answered ${res.statusCode}`));
            else resolve(json);
          });
        },
      );
      req.on("error", (e) => reject(new KubeError(0, `Kubernetes isn't reachable: ${e.message}`)));
      req.setTimeout(30_000, () => req.destroy(new Error("timed out")));
      if (data) req.write(data);
      req.end();
    });
  }
  return { call };
}

/** Typed helpers over call(): create (409 = already there), get (404 = null), delete (404 = fine), list by label. */
export function kubeObjects(kube, namespace) {
  const base = {
    pods: `/api/v1/namespaces/${namespace}/pods`,
    services: `/api/v1/namespaces/${namespace}/services`,
    secrets: `/api/v1/namespaces/${namespace}/secrets`,
    pvcs: `/api/v1/namespaces/${namespace}/persistentvolumeclaims`,
  };
  const ok404 = (e) => (e.status === 404 ? null : Promise.reject(e));
  return {
    create: (kind, obj) => kube.call("POST", base[kind], obj).catch((e) => (e.status === 409 ? null : Promise.reject(e))),
    get: (kind, name) => kube.call("GET", `${base[kind]}/${encodeURIComponent(name)}`).catch(ok404),
    remove: (kind, name, graceSeconds) => kube.call("DELETE", `${base[kind]}/${encodeURIComponent(name)}${graceSeconds !== undefined ? `?gracePeriodSeconds=${graceSeconds}` : ""}`).catch(ok404),
    list: (kind, selector) => kube.call("GET", `${base[kind]}?labelSelector=${encodeURIComponent(selector)}`).then((r) => r?.items ?? []),
  };
}
