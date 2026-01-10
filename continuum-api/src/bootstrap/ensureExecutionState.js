export async function ensureExecutionState(db, userId) {
  const existing = await db
    .collection("execution_state")
    .findOne({ userId });

  if (!existing) {
    await db.collection("execution_state").insertOne({
      userId,
      activeProjectId: null,
      updatedAt: new Date(),
    });
  }
}
