import { withSystemContext } from "../logging/childLogger.js";

export async function validateInvariants(db) {
    const log = withSystemContext("bootstrap");
  log.debug("🔍 Validating invariants...");

  const users = await db.collection("users").find().toArray();
  const executionCol = db.collection("execution_state");

  let repaired = 0;

  for (const user of users) {
    const exists = await executionCol.findOne({ userId: user._id });

    if (!exists) {
      await executionCol.insertOne({
        userId: user._id,
        activeProjectId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      log.warn(
        { userId: user._id, reason: "missing_execution_state" },
        "Invariant repaired"
      );
      repaired++;
    }
  }

  if (repaired === 0) {
    log.info("✅ No invariant violations found");
  }

  return { repaired };
}
