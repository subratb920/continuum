// src/data/engine.js
//
// continuum-data (Continuum's data engineering engine) runs inside this API,
// mounted at /data, when DATA_ENABLED=true. It lives in ../continuum-data and
// imports nothing from here; it is only loaded when switched on, so builds
// without that folder are unchanged. DATA_MODULE points elsewhere when the
// folder is mounted at another path (Docker Compose).

import { logger } from "../logging/logger.js";

const enabled = process.env.DATA_ENABLED === "true";
const modulePath = process.env.DATA_MODULE || new URL("../../../continuum-data/src/index.js", import.meta.url).href;

async function load() {
  const { createDataEngine, dataConfigFromEnv } = await import(modulePath);
  return createDataEngine(dataConfigFromEnv(process.env), { log: logger.child({ part: "data" }) });
}

/** The data engine, or null when switched off. */
export const dataEngine = enabled ? await load() : null;
