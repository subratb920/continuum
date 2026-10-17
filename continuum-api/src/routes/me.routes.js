import express from "express";
import { getDB } from "../config/db.js";
import { readTheme, setTheme } from "../services/appearance.js";
import { FEATURES } from "../access/features.js";

const router = express.Router();

/**
 * You: your role and the features it has switched on (what the screen shows
 * as open or "No feature access"), whether you're an admin, and every feature
 * there is (with its label), so the screen can name what's switched off.
 */
router.get("/", (req, res) => {
  const a = req.access;
  res.set("Cache-Control", "no-store").json({
    id: a.userId,
    email: a.email,
    role: a.role,
    features: a.features,
    isAdmin: a.isAdmin,
    allFeatures: FEATURES.map(({ id, label }) => ({ id, label })),
  });
});

// The signed-in user's preferences kept with their account (shared with Continuum Deploy)
router.get("/preferences", async (req, res) => {
  res.json(await readTheme(getDB(), req.user.id));
});

router.patch("/preferences", async (req, res) => {
  const theme = await setTheme(getDB(), req.user.id, req.body?.theme);
  res.json({ theme, chosen: true });
});

export default router;
