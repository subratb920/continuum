import { ensureCollections } from "./ensureCollections.js";
import { ensureIndexes } from "./ensureIndexes.js";
import { validateInvariants } from "./validateInvariants.js";
import { directory, dir } from "../directory/directory.js";
import { withSystemContext } from "../logging/childLogger.js";

export async function bootstrapSystem(db) {
  const log = withSystemContext("bootstrap");
  
  log.info("Bootstrap starting");

  const colResult = await ensureCollections(db);
  const idxResult = await ensureIndexes(db);
  const invResult = await validateInvariants(db);
  // Projects by space (personal, or an organization's)
  await db.collection("projects").createIndex({ spaceId: 1 }, { name: "spaceId", sparse: true });
  // The directory (continuum-directory, its own Postgres): users, roles, organizations, sign-ins.
  // Its first start fills it from what this MongoDB kept (read only); the owner is made admin.
  await directory.start();
  // No admin yet: a one-time setup code, in this log only (claimed in the Directory)
  const setup = await dir.prepareAdminSetup();
  if (setup?.existing) {
    log.warn({ expiresAt: setup.expiresAt }, "🔑 No admin yet. A setup code was written to the log when it was made (by this or another copy); it's valid until it expires.");
  } else if (setup) {
    log.warn(
      { expiresAt: setup.expiresAt },
      `🔑 No admin yet. Sign in to Continuum, open Admin in your profile menu (the Directory) and enter this one-time setup code: ${setup.code} (valid 24 hours, until a restart makes a new one)`
    );
  }

  const didWork =
    colResult.created > 0 ||
    idxResult.created > 0 ||
    invResult.repaired > 0;

  if (!didWork) {
    log.info(
      {
        collectionsCreated: colResult.created,
        indexesCreated: idxResult.created,
        invariantsRepaired: invResult.repaired,
      },
      "Bootstrap completed with repairs"
    );
  } else {
    log.info("🧠 Bootstrap mode: REPAIR / INITIALIZE");
  }

  log.info("Bootstrap completed (NOOP)");
}
