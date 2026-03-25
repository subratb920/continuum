import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  startBridge,
  updateBridge,
  getProjectBridges,
} from "../controllers/bridge.controller.js";

const router = express.Router();

router.post("/start", requireAuth, startBridge);
router.patch("/:id", requireAuth, updateBridge);
router.get("/project/:id", requireAuth, getProjectBridges);

export default router;
