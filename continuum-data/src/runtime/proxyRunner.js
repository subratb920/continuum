import { TemporaryJobError } from "../errors.js";

/**
 * RunnerDriver, Phase 1: runs steps in continuum-data-runner containers
 * through continuum-data-runner-proxy, the one small service holding Docker's
 * socket (owner's decision Q1, 2026-10-16). It can start only that image, with
 * fixed mounts and limits, so this process never controls Docker itself.
 */
export function proxyRunner({ url, token, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new TemporaryJobError("RUNNER_UNREACHABLE", `The data runner isn't reachable: ${e.message}`);
    }
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new TemporaryJobError("RUNNER_ERROR", `The data runner answered ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }

  return {
    /**
     * Runs one step to the end: starts it (replacing a container of the same
     * name left by a crash), hands each output line to onLine, and resolves
     * with the exit code. The signal stops it early and removes the container.
     */
    async run({ name, step, userId, op, params, network = false, timeoutSec = 7200 }, onLine, signal) {
      await call("POST", "/runs", { name, step, userId: String(userId), op, params, network, timeoutSec });
      const abort = () => call("DELETE", `/runs/${name}`).catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      try {
        let res;
        try {
          res = await fetchImpl(`${url}/runs/${name}/follow`, { headers, signal });
        } catch (e) {
          if (signal?.aborted) throw signal.reason ?? e;
          throw new TemporaryJobError("RUNNER_UNREACHABLE", `Lost the data runner: ${e.message}`);
        }
        if (!res.ok) throw new TemporaryJobError("RUNNER_ERROR", `The data runner answered ${res.status}`);
        let exitCode = null;
        let buffer = "";
        const decoder = new TextDecoder();
        const handle = (line) => {
          if (!line.trim()) return;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            msg = { kind: "log", message: line };
          }
          if (msg.kind === "exit") exitCode = msg.code;
          else onLine(msg);
        };
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buffer.indexOf("\n")) >= 0) {
            handle(buffer.slice(0, i));
            buffer = buffer.slice(i + 1);
          }
        }
        handle(buffer);
        if (exitCode === null) throw new TemporaryJobError("RUNNER_LOST", "The step's output ended before it finished.");
        return exitCode;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (!signal?.aborted) await call("DELETE", `/runs/${name}`).catch(() => {});
      }
    },
    remove: (name) => call("DELETE", `/runs/${name}`),
  };
}
