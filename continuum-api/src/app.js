import express from "express";
import { corsMiddleware } from "./middleware/cors.middleware.js";
import authRoutes from "./auth/auth.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

import projectRoutes from "./routes/project.routes.js";
import executionRoutes from "./routes/execution.routes.js";
import bridgeRoutes from "./routes/bridge.routes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requestLogger } from "./middleware/requestLogger.js";
import githubRoutes from "./auth/github.routes.js";
import oauthRoutes from "./oauth/oauth.routes.js";
import deployRoutes from "./oauth/deploy.routes.js";
import supportRoutes from "./routes/support.routes.js";
import createRoutes from "./create/routes.js";
import publishRoutes from "./create/publish.js";
import cloneRoutes from "./create/clone.js";
import meRoutes from "./routes/me.routes.js";
import { createWorkspacesRouter } from "./workspaces/routes.js";
import { createServiceRouter } from "./service/routes.js";
import { createBrainRouter, streamToken } from "./brain/routes.js";
import { dataEngine } from "./data/engine.js";


const app = express();

app.use(corsMiddleware());
// 1 MB: a device import sends its file list (paths and sizes, at most 5000)
app.use(express.json({ limit: "1mb" }));

// 👇 must come AFTER body parsing, BEFORE routes
app.use(requestLogger);

// Routes
app.use("/auth", authRoutes);
app.use("/oauth", oauthRoutes); // SSO for continuum-deploy
app.use("/deploy", deployRoutes); // read-only data for continuum-deploy (its access token only)
app.use("/github", requireAuth, githubRoutes);
app.use("/projects", requireAuth, publishRoutes); // "Put on GitHub" (before the JSON-only project routes)
app.use("/projects", requireAuth, cloneRoutes); // Download from GitHub: a project's repository as a git clone
app.use("/projects", requireAuth, projectRoutes);
app.use("/execution", requireAuth, executionRoutes);
app.use("/bridges", requireAuth, bridgeRoutes);
app.use("/support", requireAuth, supportRoutes); // Contact us: callback requests
app.use("/create", requireAuth, createRoutes); // New Project wizard: catalogue and generated projects
app.use("/me", requireAuth, meRoutes); // the user's own preferences (theme), shared with Continuum Deploy
app.use("/workspaces", requireAuth, createWorkspacesRouter()); // development servers per project (continuum-workspaces)
app.use("/service", createServiceRouter()); // read-only data for continuum-brain (its service token only)
app.use("/brain", streamToken, requireAuth, createBrainRouter()); // the Agents screen, relayed to continuum-brain
if (dataEngine) app.use("/data", dataEngine.router({ auth: requireAuth })); // datasets: sources, versions, pipelines (continuum-data)

// ❗ MUST BE LAST
app.use(errorMiddleware);

export default app;
