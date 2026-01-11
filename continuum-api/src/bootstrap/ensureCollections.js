import { withSystemContext } from "../logging/childLogger.js";

export async function ensureCollections(db) {
  const log = withSystemContext("bootstrap");

  log.debug("Checking collections");

  const existing = new Set(
    (await db.listCollections().toArray()).map(c => c.name)
  );

  const required = [
    "users",
    "projects",
    "bridges",
    "execution_state",
  ];

  let created = 0;

  for (const name of required) {
    if (!existing.has(name)) {
      await db.createCollection(name);
      log.info({ collection: name }, "Collection created");
      created++;
    } else {
      log.info({ collection: name }, `📂 Collection exists: ${name}`);
    }
  }

  if (created === 0) {
    log.debug("✅ All collections already exist");
  }

  return { created };
}
