import express from "express";
import { corsMiddleware } from "./middleware/cors.middleware.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

import projectRoutes from "./routes/project.routes.js";
import executionRoutes from "./routes/execution.routes.js";
import bridgeRoutes from "./routes/bridge.routes.js";

const app = express();

app.use(corsMiddleware());
app.use(express.json());
app.use(authMiddleware);

// Routes
app.use("/projects", projectRoutes);
app.use("/execution", executionRoutes);
app.use("/bridges", bridgeRoutes);

// ❗ MUST BE LAST
app.use(errorMiddleware);

export default app;
