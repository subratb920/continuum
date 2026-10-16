import { Readable } from "node:stream";
import { badRequest, TemporaryJobError } from "../errors.js";

/**
 * StorageDriver in the cloud: the users' folders sit on one disk served by the
 * data store pod (runner-image cdata/store_server.py, started by kubeStore),
 * because continuum-api's own pods can't mount that disk. The same calls as
 * localStorage; connect() gives the store's { url, token } (starting it when
 * needed), and unreachable() says to look at the store again.
 */
export function remoteStorage(connect, { fetchImpl = fetch, unreachable = () => {} } = {}) {
  async function call(method, userId, what, { path, query = {}, headers = {}, body, ok = [] } = {}) {
    const { url, token } = await connect();
    const q = new URLSearchParams({ ...(path !== undefined ? { path } : {}), ...query });
    let res;
    try {
      res = await fetchImpl(`${url}/u/${userId}/${what}${q.size ? `?${q}` : ""}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...headers },
        ...(body ? { body, duplex: "half" } : {}),
      });
    } catch (e) {
      if (e?.code === "TOO_BIG") throw e;
      unreachable();
      throw new TemporaryJobError("STORE_UNREACHABLE", `The data store isn't reachable: ${e.message}`);
    }
    if (res.ok || ok.includes(res.status)) return res;
    const text = await res.text().catch(() => "");
    if (res.status === 400) throw badRequest("That path isn't allowed.", "BAD_PATH");
    if (res.status === 413) throw badRequest("That file is bigger than your space allows.", "TOO_BIG");
    throw new TemporaryJobError("STORE_ERROR", `The data store answered ${res.status}: ${text.slice(0, 200)}`);
  }

  /** Paths are checked here as well as by the store: relative, inside the folder. */
  function check(rel) {
    if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").some((s) => s === "" || s === "." || s === "..")) {
      throw badRequest("That path isn't allowed.", "BAD_PATH");
    }
    return rel;
  }
  const user = (userId) => {
    const id = String(userId);
    if (!/^[0-9a-f]{24}$/.test(id)) throw badRequest("That path isn't allowed.", "BAD_PATH");
    return id;
  };

  return {
    kind: "remote",
    resolve: (userId, rel) => (user(userId), check(rel)),
    async ensureUser(userId) {
      await call("POST", user(userId), "ensure");
    },
    async usage(userId) {
      return (await (await call("GET", user(userId), "usage")).json()).bytes;
    },
    async remove(userId, rel) {
      await call("DELETE", user(userId), "file", { path: check(rel) });
    },
    async readJson(userId, rel) {
      const res = await call("GET", user(userId), "file", { path: check(rel), ok: [404] });
      if (res.status === 404) return null;
      return JSON.parse(await res.text());
    },
    /** { size } or null when there is nothing at that path. */
    async stat(userId, rel) {
      const res = await call("GET", user(userId), "stat", { path: check(rel), ok: [404] });
      return res.status === 404 ? null : res.json();
    },
    /** A file's bytes as a stream. */
    async readStream(userId, rel) {
      const res = await call("GET", user(userId), "file", { path: check(rel) });
      return Readable.fromWeb(res.body);
    },
    /** A file hyparquet reads by byte ranges (only the parts it needs travel). */
    async fileBuffer(userId, rel) {
      const path = check(rel);
      const id = user(userId);
      const info = await this.stat(id, path);
      if (!info) throw badRequest("That file isn't there.", "NOT_FOUND");
      return {
        byteLength: info.size,
        async slice(start, end = info.size) {
          if (end <= start) return new ArrayBuffer(0);
          const res = await call("GET", id, "file", { path, headers: { Range: `bytes=${start}-${end - 1}` } });
          return res.arrayBuffer();
        },
      };
    },
    /** Writes a stream to a file, stopping with TOO_BIG past maxBytes. */
    async writeStream(userId, rel, stream, maxBytes) {
      let seen = 0;
      const limited = async function* () {
        for await (const chunk of stream) {
          seen += chunk.length;
          if (seen > maxBytes) throw badRequest("That file is bigger than your space allows.", "TOO_BIG");
          yield chunk;
        }
      };
      try {
        await call("PUT", user(userId), "file", { path: check(rel), query: { max: String(maxBytes) }, headers: { "Content-Type": "application/octet-stream" }, body: limited() });
      } catch (e) {
        if (seen > maxBytes) throw badRequest("That file is bigger than your space allows.", "TOO_BIG");
        throw e;
      }
      return seen;
    },
  };
}
