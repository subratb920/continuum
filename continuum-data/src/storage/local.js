import { chown, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { asyncBufferFromFile } from "hyparquet";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { badRequest } from "../errors.js";

/**
 * StorageDriver, Phase 1: a folder on this machine (spec 2.12). Each user has
 * <root>/<userId>/, which is also the only folder their runner containers see.
 * Every path inside it is relative and checked, so nothing can leave it.
 */
const RUNNER_UID = 1000;

export function localStorage(root) {
  const userRoot = (userId) => path.join(root, String(userId));

  function resolve(userId, rel) {
    const base = userRoot(userId);
    const full = path.resolve(base, rel);
    if (path.isAbsolute(rel) || (full !== base && !full.startsWith(base + path.sep))) throw badRequest("That path isn't allowed.", "BAD_PATH");
    return full;
  }

  async function size(full) {
    let st;
    try {
      st = await stat(full);
    } catch {
      return 0;
    }
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const e of await readdir(full)) total += await size(path.join(full, e));
    return total;
  }

  return {
    kind: "local",
    resolve,
    /** The user's folder; runners write to it as uid 1000, so it is theirs when we run as root. */
    async ensureUser(userId) {
      const dir = userRoot(userId);
      await mkdir(dir, { recursive: true });
      if (process.getuid?.() === 0) await chown(dir, RUNNER_UID, RUNNER_UID);
    },
    usage: (userId) => size(userRoot(userId)),
    remove: (userId, rel) => rm(resolve(userId, rel), { recursive: true, force: true }),
    async readJson(userId, rel) {
      try {
        return JSON.parse(await readFile(resolve(userId, rel), "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    /** Writes a stream to a file, stopping with TOO_BIG past maxBytes. */
    async writeStream(userId, rel, stream, maxBytes) {
      const full = resolve(userId, rel);
      await mkdir(path.dirname(full), { recursive: true });
      let seen = 0;
      const limit = async function* (source) {
        for await (const chunk of source) {
          seen += chunk.length;
          if (seen > maxBytes) throw badRequest("That file is bigger than your space allows.", "TOO_BIG");
          yield chunk;
        }
      };
      try {
        await pipeline(stream, limit, createWriteStream(full));
      } catch (e) {
        await rm(full, { force: true });
        throw e;
      }
      return seen;
    },
    /** { size } or null when there is nothing at that path. */
    async stat(userId, rel) {
      const info = await stat(resolve(userId, rel)).catch(() => null);
      return info ? { size: info.size, dir: info.isDirectory() } : null;
    },
    /** A file's bytes as a stream. */
    readStream: async (userId, rel) => createReadStream(resolve(userId, rel)),
    /** A file hyparquet reads by byte ranges. */
    fileBuffer: (userId, rel) => asyncBufferFromFile(resolve(userId, rel)),
    async list(userId, rel) {
      try {
        return await readdir(resolve(userId, rel), { recursive: true, withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
    },
  };
}
