import express from "express";
import { getDB } from "../config/db.js";
import { createSupportService } from "../services/supportRequests.js";

const router = express.Router();

// Contact us → Request a callback (signed-in users)
router.post("/callbacks", async (req, res) => {
  const support = createSupportService(getDB());
  const saved = await support.requestCallback(req.user, req.body);
  req.log.info({ userId: req.user.id, requestId: String(saved.id), bestTime: saved.bestTime }, "Callback requested");
  res.status(201).json({ id: saved.id, bestTime: saved.bestTime, createdAt: saved.createdAt });
});

export default router;
