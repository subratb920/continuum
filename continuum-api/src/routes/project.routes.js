import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getProjects,
  createProject,
  deleteProject,
} from "../controllers/project.controller.js";
import { getProjectBridges } from "../controllers/bridge.controller.js";

const router = express.Router();

router.get("/", requireAuth, getProjects);
router.post("/", requireAuth, createProject);
router.delete("/:id", requireAuth, deleteProject);
router.get("/:id/bridges", requireAuth, getProjectBridges);

export default router;
