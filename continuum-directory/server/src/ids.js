import { randomBytes } from "node:crypto";

/**
 * Ids are 24 hex characters, like Continuum's other records (a human's id is
 * their Continuum account's), so "o:<id>" spaces and other apps' checks keep
 * working: 4 bytes of time, then 8 random.
 */
export function newId(now = Date.now()) {
  const t = Buffer.alloc(4);
  t.writeUInt32BE(Math.floor(now / 1000) >>> 0);
  return t.toString("hex") + randomBytes(8).toString("hex");
}

export const HEX24 = /^[a-f0-9]{24}$/;
export const isId = (v) => HEX24.test(String(v ?? ""));
