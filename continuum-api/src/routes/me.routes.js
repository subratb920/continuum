import express from "express";
import { getDB } from "../config/db.js";
import { readTheme, setTheme } from "../services/appearance.js";
import { FEATURES } from "../access/features.js";
import { attachClient } from "../access/activity.js";
import { usage } from "../middleware/access.js";
import { adminSetupOpen, claimAdmin } from "../access/access.js";

const router = express.Router();

/**
 * You: your role and the features it has switched on (what the screen shows
 * as open or "No feature access"), whether you're an admin, and every feature
 * there is (with its label), so the screen can name what's switched off.
 */
router.get("/", async (req, res) => {
  const a = req.access;
  res.set("Cache-Control", "no-store").json({
    // No admin yet: the Admin page offers to claim it with the setup code (from this API's log)
    ...(a.isAdmin ? {} : { adminSetup: await adminSetupOpen(getDB()) }),
    id: a.userId,
    email: a.email,
    role: a.role,
    features: a.features,
    isAdmin: a.isAdmin,
    allFeatures: FEATURES.map(({ id, label }) => ({ id, label })),
  });
});

// The signed-in user's preferences kept with their account (shared with Continuum Deploy)
// After a sign-in, the browser says what it is (screen, time zone, language…): added to that sign-in
router.post("/session", async (req, res) => {
  const added = await attachClient(getDB(), req.user.id, req.body ?? {});
  res.json({ added });
});

// The screen says which app you opened (a screen like the Dashboard asks nothing of its own): counted as use
router.post("/open", (req, res) => {
  const app = req.body?.app;
  if (FEATURES.some((f) => f.id === app) && req.access.features.includes(app)) usage.used(req.user.id, app);
  res.status(204).end();
});

// The first admin: the one-time setup code this API wrote to its log while there's no admin.
// A few tries per account per 15 minutes, so it can't be guessed.
const claimTries = new Map(); // userId → [times]
router.post("/claim-admin", async (req, res) => {
  const key = String(req.user.id);
  const now = Date.now();
  const recent = (claimTries.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 5) return res.status(429).json({ error: "Too many tries. Wait 15 minutes.", code: "TOO_MANY_TRIES" });
  claimTries.set(key, [...recent, now]);
  const ok = await claimAdmin(getDB(), req.user.id, typeof req.body?.code === "string" ? req.body.code : "");
  if (!ok) return res.status(400).json({ error: "That code isn't right, has expired, or there's an admin already.", code: "BAD_SETUP_CODE" });
  claimTries.delete(key);
  await getDB()
    .collection("admin_audit")
    .insertOne({ type: "ADMIN_CLAIMED", by: req.user.id, byEmail: req.access.email, at: new Date(), ip: req.ip ?? null, metadata: { email: req.access.email } })
    .catch(() => {});
  req.log.warn({ userId: key }, "First admin claimed with the setup code");
  res.json({ isAdmin: true });
});

router.get("/preferences", async (req, res) => {
  res.json(await readTheme(getDB(), req.user.id));
});

router.patch("/preferences", async (req, res) => {
  const theme = await setTheme(getDB(), req.user.id, req.body?.theme);
  res.json({ theme, chosen: true });
});

export default router;
