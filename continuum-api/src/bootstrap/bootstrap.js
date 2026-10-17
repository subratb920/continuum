import { ensureCollections } from "./ensureCollections.js";
import { ensureIndexes } from "./ensureIndexes.js";
import { validateInvariants } from "./validateInvariants.js";
import { ensureAccess, prepareAdminSetup } from "../access/access.js";
import { ensureActivity } from "../access/activity.js";
import { withSystemContext } from "../logging/childLogger.js";

export async function bootstrapSystem(db) {
  const log = withSystemContext("bootstrap");
  
  log.info("Bootstrap starting");

  const colResult = await ensureCollections(db);
  const idxResult = await ensureIndexes(db);
  const invResult = await validateInvariants(db);
  await ensureAccess(db); // the built-in roles (admin, member) and the default role for new users
  await ensureActivity(db); // sign-ins and app use (kept LOGIN_HISTORY_DAYS)
  // No admin yet: a one-time setup code, in this log only (claimed on the Admin page)
  const setup = await prepareAdminSetup(db);
  if (setup?.existing) {
    log.warn({ expiresAt: setup.expiresAt }, "🔑 No admin yet. A setup code was written to the log when it was made (by this or another copy); it's valid until it expires.");
  } else if (setup) {
    log.warn(
      { expiresAt: setup.expiresAt },
      `🔑 No admin yet. Sign in to Continuum, open /admin and enter this one-time setup code: ${setup.code} (valid 24 hours, until a restart makes a new one)`
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
