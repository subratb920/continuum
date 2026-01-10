// src/server.js

// 1️⃣ Load environment variables ONCE (must be first)
import "dotenv/config";

import app from "./app.js";
import { ENV } from "./config/env.js";
import { connectToDB } from "./config/db.js";
import { bootstrapSystem } from "./bootstrap/bootstrap.js";

let server;

async function startServer() {
  try {
    // 2️⃣ Connect to database
    const db = await connectToDB();

    // 3️⃣ Bootstrap application invariants / setup
    await bootstrapSystem(db);

    // 4️⃣ Start HTTP server
    server = app.listen(ENV.PORT, () => {
      console.log(`🚀 Server running on port ${ENV.PORT}`);
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  }
}

// 5️⃣ Graceful shutdown (SIGTERM, SIGINT)
async function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log("✅ HTTP server closed");
    }

    // If later you add DB client close logic, it goes here
    // await closeDB();

    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
    process.exit(1);
  }
}

// 6️⃣ Handle process signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 7️⃣ Start the server
startServer();
