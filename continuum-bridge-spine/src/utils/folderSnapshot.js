import { tarGzOf } from "./tarWriter";

/**
 * A snapshot of your project folder on this computer (a .tar.gz, top folder
 * "project/"), for workers that work in your folder: they start from it, and
 * the changes you allow come back into the folder. Left out, as when a folder
 * goes to GitHub: dependencies, git, build output, .env files; and, as the
 * workers themselves may never read them, keys and credentials.
 */
export const LEFT_OUT = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|__pycache__|\.venv)(\/|$)|(^|\/)\.env(\.[^/]*)?$/;
const SECRETS = /(^|\/)(id_rsa[^/]*|\.npmrc|\.git-credentials)$|\.(pem|key)$/i;
const MAX_FILES = 5000;
const MAX_BYTES = 50 * 1024 * 1024;

/** Every file of the folder worth sending, as [{ path, file }]; how many were left out. */
export async function filesOfFolder(handle) {
  const files = [];
  let skipped = 0;
  let bytes = 0;
  async function walk(dir, prefix) {
    for await (const [name, entry] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (LEFT_OUT.test(path) || (entry.kind === "file" && SECRETS.test(path))) {
        skipped++;
        continue;
      }
      if (entry.kind === "directory") {
        await walk(entry, path);
        continue;
      }
      const file = await entry.getFile();
      bytes += file.size;
      files.push({ path, file });
      if (files.length > MAX_FILES) throw new Error(`Your folder has more than ${MAX_FILES} files (without dependencies and build output): too many to send.`);
      if (bytes > MAX_BYTES) throw new Error("Your folder is bigger than 50 MB (without dependencies and build output): too big to send.");
    }
  }
  await walk(handle, "");
  if (!files.length) throw new Error("Your folder has no files to work on.");
  return { files, bytes, skipped };
}

/** The folder as a .tar.gz Blob, with how many files it holds. */
export async function snapshotOf(handle) {
  const { files, bytes, skipped } = await filesOfFolder(handle);
  return { blob: await tarGzOf(files), files: files.length, bytes, skipped };
}
