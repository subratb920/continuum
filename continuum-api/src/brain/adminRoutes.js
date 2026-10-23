// src/brain/adminRoutes.js
//
// Operator ("Continuum super admin", the `admin` feature) control of the brain,
// relayed to continuum-brain's brain-api /control/* endpoints. These act across ALL
// of Continuum (not one tenant), so they are mounted separately from /brain and gated
// by requireFeature("admin"). Consumed by the Directory app's "Brain control" page.
//   GET  /admin/brain/overview                 global switch + ceilings, live totals, per-user roster
//   POST /admin/brain/stop-all                 pause everything + hard-kill every agent now
//   POST /admin/brain/resume                   lift the pause
//   PUT  /admin/brain/limits {…OperatorLimits} global ceilings
//   GET  /admin/brain/users/:id                one user's control + live agents
//   POST /admin/brain/users/:id/stop           hard-kill that user's agents now
//   PUT  /admin/brain/users/:id {paused?, limits?}  that user's pause + ceilings
import express from "express";
import { AppError } from "../errors/AppError.js";
import { brainClient, BrainUnavailableError } from "./client.js";

const USER_ID = /^[a-f0-9]{24}$/;

export function createAdminBrainRouter(opts = {}) {
  const router = express.Router();
  let client = opts.client ?? null;
  router.use((_req, _res, next) => {
    client ??= process.env.BRAIN_URL && process.env.BRAIN_INTERNAL_TOKEN ? brainClient(process.env.BRAIN_URL, process.env.BRAIN_INTERNAL_TOKEN) : null;
    if (!client) return next(new AppError("The brain isn't set up here.", 503, "BRAIN_UNAVAILABLE"));
    next();
  });

  // The operator's own id travels as the user (for audit); brain-api's control endpoints ignore the space.
  const caller = (req) => ({ userId: String(req.user.id), spaceId: `u:${req.user.id}` });
  async function brain(req, method, path, body) {
    let r;
    try {
      r = await client.call(caller(req), method, path, body);
    } catch (e) {
      if (e instanceof BrainUnavailableError) throw new AppError(e.message, 503, "BRAIN_UNAVAILABLE");
      throw e;
    }
    if (r.status >= 400) throw new AppError(r.data?.error?.message ?? "The brain couldn't do that.", r.status, r.data?.error?.code ?? "BRAIN_ERROR");
    return r.data;
  }
  const userId = (req) => {
    if (!USER_ID.test(req.params.id)) throw new AppError("No such user.", 404, "NOT_FOUND");
    return req.params.id;
  };

  router.get("/overview", async (req, res) => void res.set("Cache-Control", "no-store").json(await brain(req, "GET", "/control/overview")));
  router.post("/stop-all", async (req, res) => void res.json(await brain(req, "POST", "/control/stop-all")));
  router.post("/resume", async (req, res) => void res.json(await brain(req, "POST", "/control/resume")));
  router.put("/limits", async (req, res) => void res.json(await brain(req, "PUT", "/control/limits", req.body ?? {})));
  router.get("/users/:id", async (req, res) => void res.json(await brain(req, "GET", `/control/users/${userId(req)}`)));
  router.post("/users/:id/stop", async (req, res) => void res.json(await brain(req, "POST", `/control/users/${userId(req)}/stop`)));
  router.put("/users/:id", async (req, res) => void res.json(await brain(req, "PUT", `/control/users/${userId(req)}`, req.body ?? {})));

  return router;
}
