// src/server.js

import app from "./app.js";
import { ENV } from "./config/env.js";
import { connectToDB } from "./config/db.js";
import { bootstrapSystem } from "./bootstrap/bootstrap.js";

async function startServer() {
  try {
    // 1. Connect DB
    const db = await connectToDB();

    // 2. Bootstrap Continuum invariants
    await bootstrapSystem(db);

    // 3. Start HTTP server
    app.listen(ENV.PORT, () => {
      console.log(`🚀 Continuum API running on port ${ENV.PORT}`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

startServer();
