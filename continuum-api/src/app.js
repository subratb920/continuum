import express from "express";
import { corsMiddleware } from "./middleware/cors.middleware.js";
import authRoutes from "./auth/auth.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

import projectRoutes from "./routes/project.routes.js";
import executionRoutes from "./routes/execution.routes.js";
import bridgeRoutes from "./routes/bridge.routes.js";
import { authed, requireFeature, requireFeatureByMethod, uses } from "./middleware/access.js";
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

// Behind a proxy (Google's load balancer: TRUST_PROXY=2), req.ip is the visitor's own address
if (process.env.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

app.use(corsMiddleware());
// 1 MB: a device import sends its file list (paths and sizes, at most 5000)
app.use(express.json({ limit: "1mb" }));

// 👇 must come AFTER body parsing, BEFORE routes
app.use(requestLogger);

// Routes. Signed-in routes load the user's access (authed); each feature's
// routes refuse when the user's role has it switched off (NO_FEATURE_ACCESS).
// Projects and intervals: reading also serves the Dashboard; changing them is Interval Setup.
const projectsAccess = requireFeatureByMethod({ read: ["interval", "dashboard"], write: ["interval"] });

app.use("/auth", authRoutes);
app.use("/oauth", oauthRoutes); // SSO for continuum-deploy (its sign-in needs the deploy feature)
app.use("/deploy", deployRoutes); // read-only data for continuum-deploy (its access token only; deploy feature)
app.use("/github", authed, requireFeature("import_github"), uses("import_github"), githubRoutes);
app.post("/projects/:id/github", authed, requireFeature("publish"), uses("publish"), (_req, _res, next) => next()); // "Put on GitHub"
app.use("/projects", authed, publishRoutes); // "Put on GitHub" (before the JSON-only project routes)
app.use("/projects", authed, projectsAccess, uses("interval"), cloneRoutes); // Download from GitHub: a project's repository as a git clone
app.use("/projects", authed, projectsAccess, projectRoutes);
app.use("/execution", authed, projectsAccess, executionRoutes);
app.use("/bridges", authed, projectsAccess, uses("interval"), bridgeRoutes);
app.use("/support", authed, supportRoutes); // Contact us: callback requests (always)
// New Project wizard: catalogue and generated projects; its GitHub checks (your account, a free name) also serve "Put on GitHub"
const createAccess = (req, res, next) => (req.path.startsWith("/github") ? requireFeature("create", "publish") : requireFeature("create"))(req, res, next);
app.use("/create", authed, createAccess, uses("create"), createRoutes);
app.use("/me", authed, meRoutes); // you: your access, and your preferences (theme), shared with Continuum Deploy
app.use("/workspaces", authed, requireFeature("workspaces"), uses("workspaces"), createWorkspacesRouter()); // development servers per project (continuum-workspaces)
app.use("/service", createServiceRouter()); // read-only data for continuum-brain (its service token only)
app.use("/brain", streamToken, authed, requireFeature("agents"), uses("agents"), createBrainRouter()); // the Agents screen, relayed to continuum-brain
if (dataEngine) app.use("/data", dataEngine.router({ auth: [...authed, requireFeature("data"), uses("data")] })); // datasets: sources, versions, pipelines (continuum-data)

// ❗ MUST BE LAST
app.use(errorMiddleware);

export default app;
