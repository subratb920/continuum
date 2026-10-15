/**
 * A folder's files as a .tar.gz, made in the browser (for "Put on GitHub").
 * Plain ustar with a top folder "project/" and pax headers for long paths;
 * gzip by the browser's own CompressionStream. Read back by continuum-api's
 * readTarGz.
 */

const BLOCK = 512;
const enc = new TextEncoder();

function octal(n, width) {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name, size, type = "0", mode = 0o644) {
  const h = new Uint8Array(BLOCK);
  const put = (text, at) => h.set(enc.encode(text), at);
  put(name.slice(0, 99), 0);
  put(octal(mode, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(Math.floor(Date.now() / 1000), 12), 136);
  put("        ", 148); // checksum counted as spaces
  put(type, 156);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  put(octal(sum, 7) + " ", 148);
  return h;
}

const pad = (n) => new Uint8Array((BLOCK - (n % BLOCK)) % BLOCK);

/** A pax record "<len> path=<name>\n" (its length counts itself). */
function paxPath(name) {
  const body = ` path=${name}\n`;
  let len = enc.encode(body).length + 1;
  while (String(len).length + enc.encode(body).length !== len) len = String(len).length + enc.encode(body).length;
  return enc.encode(`${len}${body}`);
}

/** files: [{ path, file }] (File objects) → a gzip Blob */
export async function tarGzOf(files) {
  const parts = [];
  for (const { path, file } of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    const name = `project/${path}`;
    if (enc.encode(name).length > 99) {
      const pax = paxPath(name);
      parts.push(header("pax", pax.length, "x"), pax, pad(pax.length));
    }
    parts.push(header(name, data.length), data, pad(data.length));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const tar = new Blob(parts);
  return new Response(tar.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}
