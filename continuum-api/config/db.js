// src/config/db.js

import { MongoClient } from "mongodb";
import { ENV } from "./env.js";

let dbInstance = null;

export async function connectToDB() {
  if (dbInstance) return dbInstance;

  const client = new MongoClient(ENV.MONGO_URI);
  await client.connect();

  dbInstance = client.db(ENV.DB_NAME);

  console.log("🗄️ MongoDB connected");

  return dbInstance;
}
