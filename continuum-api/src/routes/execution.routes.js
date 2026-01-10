import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getActiveProject,
  activateProject,
  deactivateProject,
} from "../controllers/execution.controller.js";

const router = express.Router();

router.get("/active-project", requireAuth, getActiveProject);
router.post("/activate-project", requireAuth, activateProject);
router.post("/deactivate-project", requireAuth, deactivateProject);

export default router;
