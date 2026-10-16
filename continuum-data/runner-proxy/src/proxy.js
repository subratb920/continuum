import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { demux, DockerError } from "./docker.js";

/**
 * continuum-data-runner-proxy: the one part of continuum-data that holds
 * Docker's socket (owner's decision Q1, 2026-10-16). It can only start the
 * runner image, with the owning user's folder as /store, fixed limits, no
 * privileges, and no network unless the step is a download. Everything else
 * Docker can do stays out of reach of continuum-api.
 *
 *   GET    /health
 *   POST   /runs               { name, step, userId, op, params, network, timeoutSec }
 *                               (any earlier container of the same step is removed first)
 *   GET    /runs/:name/follow  output lines (JSON), then {"kind":"exit","code":N}
 *   DELETE /runs/:name
 */
export const OPS = new Set([
  "fetch", "ingest", "profile",
  "dedupe", "filter", "fix_types", "fill_missing", "outliers", "redact_pii", "safety", "repair_media",
  "label", "review.apply", "find_label_errors", "balance", "augment", "synthesise", "to_chat",
  "resize", "resample", "encode", "tokenise", "split", "validate", "export", "card", "publish",
]);
const NAME = /^cdata-[a-z0-9-]{1,80}$/;
const STEP = /^[a-z0-9-]{1,80}$/;
const USER = /^[0-9a-f]{24}$/;
const LABEL = "continuum-data=runner";
const MAX_PARAMS = 1024 * 1024;

const digest = (s) => createHash("sha256").update(String(s)).digest();
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));

export function createProxy({ docker, token, image, storeHostPath, egressNetwork = "continuum_data_egress", limits = {}, log = console }) {
  const lim = { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512, tmpfs: "2g", maxTimeoutSec: 6 * 3600, ...limits };

  function containerSpec({ step, userId, op, params, network, timeoutSec }) {
    const deadline = Math.floor(Date.now() / 1000) + Math.min(Math.max(Number(timeoutSec) || 7200, 60), lim.maxTimeoutSec);
    return {
      Image: image,
      Cmd: ["cdata", op],
      Env: [`CDATA_PARAMS=${JSON.stringify(params ?? {})}`],
      User: "1000:1000",
      Labels: { "continuum-data": "runner", "continuum-data.step": step, "continuum-data.user": userId, "continuum-data.deadline": String(deadline) },
      HostConfig: {
        Binds: [`${storeHostPath}/${userId}:/store`],
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": `rw,size=${lim.tmpfs}` },
        NanoCpus: Math.round(lim.cpus * 1e9),
        Memory: lim.memoryBytes,
        PidsLimit: lim.pids,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        NetworkMode: network ? egressNetwork : "none",
      },
    };
  }

  async function ensureNetwork() {
    if (!(await docker.inspectNetwork(egressNetwork))) await docker.createNetwork(egressNetwork, { "continuum-data": "egress" });
  }

  async function start(body) {
    const { name, step, userId, op, params, network } = body ?? {};
    if (!NAME.test(name ?? "")) return [400, { error: "Bad run name." }];
    if (!STEP.test(step ?? "")) return [400, { error: "Bad step." }];
    if (!USER.test(userId ?? "")) return [400, { error: "Bad user id." }];
    if (!OPS.has(op)) return [400, { error: `Unknown op ${op}.` }];
    if (JSON.stringify(params ?? {}).length > MAX_PARAMS) return [400, { error: "Params too large." }];
    // Containers of an earlier try of this step (left by a crash, or a worker
    // that lost its lease) go first, so only one ever writes the step's output
    for (const c of (await docker.listContainers(`continuum-data.step=${step}`)) ?? []) await docker.removeContainer(c.Id);
    await docker.removeContainer(name);
    if (network) await ensureNetwork();
    await docker.createContainer(name, containerSpec({ ...body, network: Boolean(network) }));
    await docker.startContainer(name);
    log.info?.({ name, op, userId }, "runner started");
    return [201, { name }];
  }

  async function follow(name, res) {
    const info = await docker.inspectContainer(name);
    if (!info || info.Config?.Labels?.["continuum-data"] !== "runner") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "No such run." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const tails = { stdout: "", stderr: "" };
    const emit = (stream, line) => {
      if (!line.trim()) return;
      res.write((stream === "stdout" ? line : JSON.stringify({ kind: "stderr", message: line.slice(0, 2000) })) + "\n");
    };
    const logs = await docker.logs(name);
    res.on("close", () => logs.destroy());
    for await (const { stream, data } of demux(logs)) {
      tails[stream] += data.toString("utf8");
      let i;
      while ((i = tails[stream].indexOf("\n")) >= 0) {
        emit(stream, tails[stream].slice(0, i));
        tails[stream] = tails[stream].slice(i + 1);
      }
    }
    if (res.destroyed) return;
    emit("stdout", tails.stdout);
    emit("stderr", tails.stderr);
    const waited = await docker.waitContainer(name).catch(() => null);
    const after = await docker.inspectContainer(name);
    if (after?.State?.OOMKilled) res.write(JSON.stringify({ kind: "error", code: "OUT_OF_MEMORY", message: "The step ran out of memory." }) + "\n");
    const code = waited?.StatusCode ?? after?.State?.ExitCode ?? 1;
    res.end(JSON.stringify({ kind: "exit", code }) + "\n");
  }

  /** Stops runners past their deadline (also those left by an earlier proxy). */
  async function sweep() {
    const now = Math.floor(Date.now() / 1000);
    for (const c of (await docker.listContainers(LABEL)) ?? []) {
      const deadline = Number(c.Labels?.["continuum-data.deadline"] ?? 0);
      if (c.State === "running" && deadline && deadline < now) {
        const name = c.Names?.[0]?.replace(/^\//, "");
        log.warn?.({ name }, "runner past its time limit: removed");
        await docker.removeContainer(name).catch(() => {});
      }
    }
  }

  const server = createServer(async (req, res) => {
    const json = (status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    try {
      const url = new URL(req.url, "http://proxy");
      if (req.method === "GET" && url.pathname === "/health") return json(200, { ok: true });
      const auth = req.headers.authorization ?? "";
      if (!token || !auth.startsWith("Bearer ") || !sameSecret(auth.slice(7), token)) return json(401, { error: "Unauthorized" });

      const m = url.pathname.match(/^\/runs(?:\/([^/]+))?(\/follow)?$/);
      if (!m) return json(404, { error: "Not found" });
      const [, name, followPath] = m;
      if (req.method === "POST" && !name) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > MAX_PARAMS + 4096) return json(413, { error: "Too large." });
          chunks.push(c);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return json(400, { error: "Bad JSON." });
        }
        const [status, out] = await start(body);
        return json(status, out);
      }
      if (!name || !NAME.test(name)) return json(400, { error: "Bad run name." });
      if (req.method === "GET" && followPath) return await follow(name, res);
      if (req.method === "DELETE" && !followPath) {
        await docker.removeContainer(name);
        return json(200, { removed: name });
      }
      return json(405, { error: "Method not allowed" });
    } catch (e) {
      log.error?.({ err: e.message }, "proxy error");
      if (!res.headersSent) json(e instanceof DockerError && e.status ? 502 : 500, { error: e.message });
      else res.end();
    }
  });

  return { server, sweep, containerSpec };
}
