// src/config/db.js
import { MongoClient } from "mongodb";
import { ENV } from "./env.js";

let client;
let db;

export async function connectToDB() {
  client = new MongoClient(ENV.MONGO_URI);
  await client.connect();

  db = client.db(ENV.DB_NAME);
  console.log("🗄️ MongoDB connected");

  return db;
}

export function getDB() {
  if (!db) {
    throw new Error("❌ Database not initialized. Call connectToDB first.");
  }
  return db;
}
