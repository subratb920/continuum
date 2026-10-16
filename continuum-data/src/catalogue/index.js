import { readFile } from "node:fs/promises";
import { licenceInfo } from "./licences.js";

/**
 * The source catalogue (spec 7.1): it starts from a checked seed list and
 * grows as people use it. Every live search result and every source someone
 * adds is saved, and sources that make datasets rise in the results.
 */
const sources = (db) => db.collection("sources");

export async function ensureSeed(db, now = new Date()) {
  const seed = JSON.parse(await readFile(new URL("./seed.json", import.meta.url), "utf8"));
  const ops = seed.map((s) => ({
    updateOne: {
      filter: { connector: s.connector, ref: s.ref },
      update: {
        $set: { title: s.title, description: s.description, modalities: s.modalities, tasks: s.tasks, licence: s.licence, seed: true },
        $setOnInsert: { size: s.size, tags: s.tags, popularity: 0, uses: 0, addedBy: "seed", ownerUserId: null, createdAt: now, checkedAt: now },
      },
      upsert: true,
    },
  }));
  if (ops.length) await sources(db).bulkWrite(ops, { ordered: false });
}

/** Saves connector results, keeping what we learnt before (uses, seed text). */
export async function saveSources(db, list, addedBy, now = new Date()) {
  if (!list.length) return;
  await sources(db).bulkWrite(
    list.map(({ connector, ref, popularity, gated, adult, ...rest }) => ({
      updateOne: {
        filter: { connector, ref },
        update: {
          $set: { popularity: popularity ?? 0, gated: Boolean(gated), adult: Boolean(adult), checkedAt: now },
          $setOnInsert: { ...rest, uses: 0, addedBy, ownerUserId: null, createdAt: now },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** The sources this user may see, best first. */
export async function searchSources(db, userId, { q, modality, task, limit = 40 }) {
  const filter = { $or: [{ ownerUserId: null }, { ownerUserId: userId }], adult: { $ne: true }, missing: { $ne: true } };
  if (modality) filter.modalities = modality;
  if (task) filter.tasks = task;
  const text = q?.trim();
  if (text) filter.$text = { $search: text };
  const cursor = sources(db)
    .find(filter, text ? { projection: { score: { $meta: "textScore" } } } : {})
    .sort(text ? { seed: -1, score: { $meta: "textScore" }, uses: -1, popularity: -1 } : { seed: -1, uses: -1, popularity: -1 })
    .limit(limit);
  return (await cursor.toArray()).map(sourceView);
}

export function sourceView(s) {
  return {
    id: String(s._id),
    connector: s.connector,
    ref: s.connector === "upload" ? null : s.ref,
    title: s.title,
    description: s.description ?? "",
    modalities: s.modalities ?? [],
    tasks: s.tasks ?? [],
    licence: licenceInfo(s.licence),
    size: s.size ?? null,
    popularity: s.popularity ?? 0,
    uses: s.uses ?? 0,
    seed: Boolean(s.seed),
    gated: Boolean(s.gated),
    private: Boolean(s.ownerUserId),
    addedBy: s.addedBy,
  };
}
