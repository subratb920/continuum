import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  getProjects,
  createProject,
  deleteProject,
} from "../controllers/project.controller.js";

const router = express.Router();

router.get("/", requireAuth, getProjects);
router.post("/", requireAuth, createProject);
router.delete("/:id", requireAuth, deleteProject);

export default router;
