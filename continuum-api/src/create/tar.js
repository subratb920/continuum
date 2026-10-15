// src/create/tar.js
//
// A gzipped ustar archive of a generated project, read back in the browser
// by continuum-bridge-spine's readTar (utils/deviceFolder.js). Long paths use
// a pax header, like GitHub's tarballs. Everything sits under one top folder
// (the reader strips it).

import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;

function octal(n, width) {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name, size, type = "0", mode = 0o644) {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(Date.now() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148, "ascii");
  return h;
}

function pad(size) {
  const rest = size % BLOCK;
  return rest ? Buffer.alloc(BLOCK - rest) : Buffer.alloc(0);
}

/** One pax record: "<len> path=<value>\n", where len counts itself. */
function paxPath(path) {
  const body = ` path=${path}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len++;
  return Buffer.from(`${len}${body}`, "utf8");
}

/**
 * files: Map or [[path, contents (string | Buffer | Uint8Array), executable?]]
 * → gzipped tar, all under `${top}/`.
 */
export function tarGz(files, top = "project") {
  const parts = [];
  for (const [path, contents, executable] of files) {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const name = `${top}/${path}`;
    if (Buffer.byteLength(name) > 99) {
      const pax = paxPath(name);
      parts.push(header("pax", pax.length, "x"), pax, pad(pax.length));
    }
    parts.push(header(name.slice(0, 99), data.length, "0", executable ? 0o755 : 0o644), data, pad(data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

/**
 * A .tar.gz read back: [{ path, data, executable }], the top folder removed
 * (e.g. Spring Initializr's starter.tgz). Paths with ".." are dropped.
 */
export function readTarGz(gz) {
  const bytes = gunzipSync(gz);
  const text = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  const out = [];
  let off = 0;
  let longName = null;
  while (off + BLOCK <= bytes.length) {
    const h = bytes.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(text(h.subarray(124, 136)).trim() || "0", 8);
    const mode = parseInt(text(h.subarray(100, 108)).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = text(h.subarray(345, 500));
    let name = longName ?? (prefix ? `${prefix}/${text(h.subarray(0, 100))}` : text(h.subarray(0, 100)));
    longName = null;
    const body = bytes.subarray(off + BLOCK, off + BLOCK + size);
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString("utf8"));
      if (m) longName = m[1];
      continue;
    }
    if (type === "L") {
      longName = text(body);
      continue;
    }
    if (type !== "0" && type !== "\0") continue;
    name = name.split("/").slice(1).join("/");
    if (name && !name.split("/").includes("..")) out.push({ path: name, data: Buffer.from(body), executable: Boolean(mode & 0o111) });
  }
  return out;
}
