// src/bootstrap/bootstrap.js

import { ensureCollections } from "./ensureCollections.js";
import { ensureIndexes } from "./ensureIndexes.js";

/**
 * Bootstraps Continuum into a valid, enforceable state.
 * This runs on EVERY server start.
 *
 * MongoDB is assumed to be disposable.
 * The application is the source of truth.
 */
export async function bootstrapSystem(db) {
  console.log("🧠 Continuum bootstrap starting...");

  // 1. Ensure collections exist
  await ensureCollections(db);

  // 2. Ensure indexes (DB-level invariants)
  await ensureIndexes(db);

  // 3. (Later) Validate invariants / repair if needed
  // await validateInvariants(db);

  console.log("✅ Continuum bootstrap complete");
}
