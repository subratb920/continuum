export async function ensureCollections(db) {
  const required = [
    "users",
    "projects",
    "bridges",
    "execution_state",
  ];

  const existing = (await db.listCollections().toArray())
    .map(c => c.name);

  for (const name of required) {
    if (!existing.includes(name)) {
      await db.createCollection(name);
    }
  }
}
