// src/server.js

// 1️⃣ Load environment variables ONCE (must be first): .env.local, then .env
import "./config/loadEnv.js";

import app from "./app.js";
import { ENV } from "./config/env.js";
import { connectToDB, closeDB } from "./config/db.js";
import { bootstrapSystem } from "./bootstrap/bootstrap.js";
import { withSystemContext } from "./logging/childLogger.js";
import { dataEngine } from "./data/engine.js";

let server;

/**
 * Application entry point
 */
async function startServer() {
  const log = withSystemContext("startup");

  try {
    // 2️⃣ Connect to MongoDB (fatal on failure)
    const db = await connectToDB();

    // 3️⃣ Bootstrap database structure & invariants
    await bootstrapSystem(db);

    // Data engine (continuum-data), when switched on: its own database and
    // worker. A problem there leaves /data answering "not ready", not the API down.
    if (dataEngine) {
      await dataEngine.start().catch((err) => log.error({ err }, "Data engine did not start"));
    }

    // 4️⃣ Start HTTP server
    server = app.listen(ENV.PORT, () => {
      log.info(
        {
          port: ENV.PORT,
          env: ENV.NODE_ENV,
        },
        "CONTINUUM is now up and running"
      );
    });
  } catch (err) {
    // Startup failure is unrecoverable
    log.fatal({ err }, "Server startup failed");
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  const log = withSystemContext("shutdown");

  log.warn({ signal }, "Shutdown signal received");

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      log.info("HTTP server closed");
    }

    if (dataEngine) await dataEngine.stop();

    await closeDB();
    log.info("Database connection closed");

    log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    log.fatal({ err }, "Error during shutdown");
  }
}

// 5️⃣ Handle process signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 6️⃣ Start server
startServer();