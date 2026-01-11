import { withSystemContext } from "../logging/childLogger.js";

export async function ensureIndexes(db) {
  const log = withSystemContext("bootstrap");
  log.debug("🧱 Checking indexes...");

  let created = 0;

  const users = db.collection("users");
  const existingUserIndexes = await users.indexes();

  if (!existingUserIndexes.find(i => i.key.email)) {
    await users.createIndex({ email: 1 }, { unique: true });
    log.info("🧱 Created index: users.email (unique)");
    created++;
  } else {
    log.debug("🧾 Index exists: users.email");
  }

  const execution = db.collection("execution_state");
  const executionIndexes = await execution.indexes();

  if (!executionIndexes.find(i => i.key.userId)) {
    await execution.createIndex({ userId: 1 }, { unique: true });
    log.info("🧱 Created index: execution_state.userId (unique)");
    created++;
  } else {
    log.debug("🧾 Index exists: execution_state.userId");
  }

  if (created === 0) {
    log.info("✅ All indexes already exist");
  }

  return { created };
}
