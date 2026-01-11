import { ensureCollections } from "./ensureCollections.js";
import { ensureIndexes } from "./ensureIndexes.js";
import { validateInvariants } from "./validateInvariants.js";
import { withSystemContext } from "../logging/childLogger.js";

export async function bootstrapSystem(db) {
  const log = withSystemContext("bootstrap");
  
  log.info("Bootstrap starting");

  const colResult = await ensureCollections(db);
  const idxResult = await ensureIndexes(db);
  const invResult = await validateInvariants(db);

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
