export async function ensureIndexes(db) {
  // users
  await db.collection("users").createIndex(
    { email: 1 },
    { unique: true }
  );

  // projects
  await db.collection("projects").createIndex(
    { userId: 1 }
  );

  // bridges
  await db.collection("bridges").createIndex(
    { projectId: 1, index: 1 },
    { unique: true }
  );

  await db.collection("bridges").createIndex(
    { projectId: 1, status: 1 }
  );

  // execution_state
  await db.collection("execution_state").createIndex(
    { userId: 1 },
    { unique: true }
  );
}
