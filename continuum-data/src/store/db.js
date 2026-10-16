import { MongoClient } from "mongodb";

/** The collections of continuum_data (spec 2.2). */
export const COLLECTIONS = [
  "sources",
  "datasets",
  "versions",
  "recipes",
  "runs",
  "run_events",
  "review_items",
  "credentials",
  "jobs",
  "settings",
  "audit_events",
];

const DAY = 24 * 60 * 60;

const INDEXES = {
  sources: [
    { key: { connector: 1, ref: 1 }, unique: true },
    { key: { title: "text", description: "text", tags: "text", ref: "text" }, weights: { title: 5, ref: 5, tags: 3, description: 1 }, name: "sources_text" },
    { key: { modalities: 1 } },
    { key: { tasks: 1 } },
    { key: { ownerUserId: 1 } },
  ],
  datasets: [{ key: { userId: 1, name: 1 }, unique: true }, { key: { userId: 1, updatedAt: -1 } }],
  versions: [{ key: { datasetId: 1, number: -1 } }, { key: { userId: 1 } }],
  runs: [{ key: { userId: 1, createdAt: -1 } }, { key: { datasetId: 1, createdAt: -1 } }, { key: { userId: 1, state: 1 } }],
  run_events: [{ key: { runId: 1, seq: 1 }, unique: true }, { key: { userId: 1, _id: 1 } }, { key: { at: 1 }, expireAfterSeconds: 30 * DAY }],
  jobs: [{ key: { status: 1, runAt: 1, priority: 1 } }, { key: { status: 1, "lease.expiresAt": 1 } }],
  credentials: [{ key: { userId: 1, kind: 1 }, unique: true }],
  settings: [{ key: { userId: 1 }, unique: true }],
  audit_events: [{ key: { userId: 1, at: -1 } }],
  review_items: [{ key: { datasetId: 1, state: 1 } }],
};

/** Connects with its own client, so the module needs nothing from its host. */
export async function connectStore(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  await client.connect();
  return { client, db: client.db(dbName) };
}

/** Creates any missing collection and index; safe to run on every start. */
export async function ensureSchema(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of COLLECTIONS) if (!existing.has(name)) await db.createCollection(name);
  for (const [name, specs] of Object.entries(INDEXES)) {
    for (const { key, ...options } of specs) await db.collection(name).createIndex(key, options);
  }
}
