// src/config/db.js

import { MongoClient } from "mongodb";
import { ENV } from "./env.js";
import { withSystemContext } from "../logging/childLogger.js";

let client;
let db;

/**
 * Mask credentials in Mongo URI for safe logging
 */
function sanitizeMongoUri(uri) {
  try {
    const url = new URL(uri);
    if (url.password) {
      url.password = "*****";
    }
    return url.toString();
  } catch {
    return "<invalid-uri>";
  }
}

/**
 * Establish MongoDB connection
 * Must be called once during startup
 */
export async function connectToDB() {
  const log = withSystemContext("db");
  const start = Date.now();

  log.info("🗄️ MongoDB connection starting...");
  log.info(`   URI: ${sanitizeMongoUri(ENV.MONGO_URI)}`);
  log.info(`   DB : ${ENV.DB_NAME}`);

  try {
    client = new MongoClient(ENV.MONGO_URI);
    await client.connect();

    db = client.db(ENV.DB_NAME);

    const duration = Date.now() - start;
    log.info(`✅ MongoDB connected successfully (${duration} ms)`);

    return db;
  } catch (err) {
    log.error("❌ MongoDB connection failed");
    log.error(`   Reason: ${err.message}`);
    throw err;
  }
}

/**
 * Get active DB instance
 */
export function getDB() {
  if (!db) {
    throw new Error(
      "❌ Database not initialized. Call connectToDB() first."
    );
  }
  return db;
}

/**
 * Gracefully close MongoDB connection
 */
/**
 * Close DB connection
 */
export async function closeDB() {
  const log = withSystemContext("db");

  if (!client) {
    log.warn("MongoDB close requested but no active connection");
    return;
  }

  try {
    await client.close();
    log.info("MongoDB connection closed");
  } catch (err) {
    log.error(
      { err },
      "MongoDB close failed"
    );
  }
}
