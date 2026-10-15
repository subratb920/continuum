import express from "express";
import { getDB } from "../config/db.js";
import { readTheme, setTheme } from "../services/appearance.js";

const router = express.Router();

// The signed-in user's preferences kept with their account (shared with Continuum Deploy)
router.get("/preferences", async (req, res) => {
  res.json(await readTheme(getDB(), req.user.id));
});

router.patch("/preferences", async (req, res) => {
  const theme = await setTheme(getDB(), req.user.id, req.body?.theme);
  res.json({ theme, chosen: true });
});

export default router;
