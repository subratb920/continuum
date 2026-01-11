import express from "express";
import { corsMiddleware } from "./middleware/cors.middleware.js";
import authRoutes from "./auth/auth.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

import projectRoutes from "./routes/project.routes.js";
import executionRoutes from "./routes/execution.routes.js";
import bridgeRoutes from "./routes/bridge.routes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requestLogger } from "./middleware/requestLogger.js";

const app = express();

app.use(corsMiddleware());
app.use(express.json());
app.use("/auth", authRoutes);

// 👇 must come AFTER body parsing, BEFORE routes
app.use(requestLogger);

// Routes
app.use("/projects", requireAuth, projectRoutes);
app.use("/execution", requireAuth, executionRoutes);
app.use("/bridges", requireAuth, bridgeRoutes);

// ❗ MUST BE LAST
app.use(errorMiddleware);

export default app;
