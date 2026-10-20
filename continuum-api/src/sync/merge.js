// src/sync/merge.js
//
// Production sync's rules, on their own (tested): records moved onto another
// account, added only (what's there is kept), and counted.

import { ObjectId } from "mongodb";

/** Exact values only: the sending account's id (ObjectId or text) and its Deploy tenant become the receiving account's. */
export function remap(v, from, to) {
  if (v instanceof ObjectId) return v.toHexString() === from ? new ObjectId(to) : v;
  if (typeof v === "string") return v === from ? to : v === `u:${from}` ? `u:${to}` : v;
  if (Array.isArray(v)) return v.map((x) => remap(x, from, to));
  if (v && typeof v === "object" && !(v instanceof Date) && v._bsontype === undefined) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, from, to)]));
  return v;
}

/** Adds what's missing (a record with the same id, or a unique value already there, is kept as it is). */
export async function addOnly(collection, docs) {
  if (!docs.length) return { added: 0, kept: 0 };
  try {
    const r = await collection.insertMany(docs, { ordered: false });
    return { added: r.insertedCount, kept: 0 };
  } catch (err) {
    const added = err?.result?.insertedCount ?? err?.insertedCount ?? 0;
    const dup = (err?.writeErrors ?? []).filter((e) => (e.code ?? e.err?.code) === 11000).length;
    if (dup + added !== docs.length) throw err;
    return { added, kept: dup };
  }
}

/** How many records of each kind (for Preview and the report). */
export function countsOf(x) {
  const part = (p) => (p ? Object.fromEntries(Object.entries(p.collections ?? p).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) : null);
  return { continuum: part(x.continuum), brain: part(x.brain), deploy: part(x.deploy), notes: x.notes ?? [] };
}

/**
 * Which of the sent projects are added: one this account already has under
 * the same name keeps its own (the copy is left out), unless it's that same
 * project (an earlier sync brought it). Answers the projects to add, the ids
 * whose bridges may come, and how many were left out for their name.
 */
export function pickProjects(sent, here) {
  const sameIds = new Set(here.map((p) => String(p._id)));
  const named = new Set(here.map((p) => p.name));
  const add = sent.filter((p) => !named.has(p.name));
  const ids = new Set([...sent.filter((p) => sameIds.has(String(p._id))), ...add].map((p) => String(p._id)));
  return { add, ids, sameName: sent.filter((p) => named.has(p.name) && !sameIds.has(String(p._id))).length };
}
