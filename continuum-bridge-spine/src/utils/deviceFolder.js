/**
 * Creating a project's folder on this device (the browser's File System Access
 * API: Chrome, Edge, Opera on desktop, and the desktop app). The user picks
 * where it goes and allows saving there; Continuum then makes <name>/ inside,
 * empty, or filled with a GitHub repository's files.
 *
 * Safari, Firefox and phones can't do this: canCreateFolders() is false there.
 */

export function canCreateFolders() {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

export const NO_FOLDERS_NOTE = "Your browser can't create folders — use Chrome or Edge on a computer.";

/**
 * Asks where the project folder(s) go. Must run straight from a click (browsers
 * only open the picker then), so call it before anything slow. Null = cancelled.
 */
export async function pickParentFolder() {
  try {
    return await window.showDirectoryPicker({ id: "continuum-projects", mode: "readwrite", startIn: "documents" });
  } catch (err) {
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

/** A folder name the system accepts: no slashes or reserved characters. */
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").trim().slice(0, 120) || "project";
}

async function exists(parent, name) {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    try {
      await parent.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

/** Makes a new folder <name> in parent (name-2, name-3 … when taken). Returns { handle, name }. */
export async function createProjectFolder(parent, name) {
  const base = safeName(name);
  let candidate = base;
  for (let n = 2; await exists(parent, candidate); n++) candidate = `${base}-${n}`;
  const handle = await parent.getDirectoryHandle(candidate, { create: true });
  return { handle, name: candidate };
}

/** Removes a folder made by createProjectFolder (when creating the project then failed). */
export async function removeProjectFolder(parent, name) {
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch {
    /* leave it: it's empty and harmless */
  }
}

/** Files of a ustar/pax tarball (GitHub's), without its top folder: [{ path, data }]. */
export function readTar(bytes) {
  const out = [];
  const text = (a) => new TextDecoder().decode(a).replace(/\0.*$/s, "");
  let off = 0;
  let longName = null;
  while (off + 512 <= bytes.length) {
    const h = bytes.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(text(h.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = text(h.subarray(345, 500));
    let name = longName ?? (prefix ? `${prefix}/${text(h.subarray(0, 100))}` : text(h.subarray(0, 100)));
    longName = null;
    const body = bytes.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      const m = /\d+ path=([^\n]+)\n/.exec(new TextDecoder().decode(body));
      if (m) longName = m[1];
      continue;
    }
    if (type === "L") {
      longName = text(body);
      continue;
    }
    if (type !== "0" && type !== "\0") continue;
    name = name.split("/").slice(1).join("/");
    if (name && !name.split("/").includes("..")) out.push({ path: name, data: body });
  }
  return out;
}

/** Writes files [{ path, data }] into a folder, making subfolders as needed. onProgress(done, total). */
export async function writeFiles(folder, files, onProgress) {
  const dirs = new Map([["", folder]]);
  const dirOf = async (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const cut = path.lastIndexOf("/");
    const parent = await dirOf(cut < 0 ? "" : path.slice(0, cut));
    const handle = await parent.getDirectoryHandle(path.slice(cut + 1), { create: true });
    dirs.set(path, handle);
    return handle;
  };
  let done = 0;
  for (const f of files) {
    const cut = f.path.lastIndexOf("/");
    const dir = await dirOf(cut < 0 ? "" : f.path.slice(0, cut));
    const file = await dir.getFileHandle(f.path.slice(cut + 1), { create: true });
    const w = await file.createWritable();
    await w.write(f.data);
    await w.close();
    onProgress?.(++done, files.length);
  }
  return done;
}

/** A gzip'd tarball (Response or Blob) → its files. */
export async function filesOfTarball(gz) {
  const stream = (gz.body ?? gz.stream()).pipeThrough(new DecompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return readTar(bytes);
}
