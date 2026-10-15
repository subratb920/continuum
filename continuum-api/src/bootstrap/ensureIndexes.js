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

  // SSO for continuum-deploy: expired codes and refresh tokens are removed automatically
  for (const [name, extra] of [
    ["oauth_codes", []],
    ["oauth_refresh_tokens", [{ familyId: 1 }, { userId: 1 }]],
  ]) {
    const col = db.collection(name);
    const existing = await col.indexes();
    if (!existing.find((i) => i.name === "expires_ttl")) {
      await col.createIndex({ expiresAt: 1 }, { name: "expires_ttl", expireAfterSeconds: 0 });
      log.info(`🧱 Created index: ${name}.expiresAt (TTL)`);
      created++;
    }
    for (const keys of extra) {
      const field = Object.keys(keys)[0];
      if (!existing.find((i) => i.key[field] && Object.keys(i.key).length === 1)) {
        await col.createIndex(keys);
        log.info(`🧱 Created index: ${name}.${field}`);
        created++;
      }
    }
  }

  // New Project wizard: the hourly limit counts a user's recent creations
  const creations = db.collection("project_creations");
  if (!(await creations.indexes().catch(() => [])).find((i) => i.name === "user_created")) {
    await creations.createIndex({ userId: 1, createdAt: -1 }, { name: "user_created" });
    log.info("🧱 Created index: project_creations.userId+createdAt");
    created++;
  }

  if (created === 0) {
    log.info("✅ All indexes already exist");
  }

  return { created };
}
