// src/auth/google.routes.js
//
// Sign in with Google (OpenID Connect, authorization code). Continuum's own
// server talks to Google; the page never sees Google's tokens.
//
//   GET /auth/google            → Google's sign-in page (with a one-time state)
//   GET /auth/google/callback   ← Google sends the person back: the code
//                                 becomes their verified email, name and id
//
// Who it is: the Google account already linked (continuum-directory's
// mapping "google"), else the Continuum account with the same address —
// Google has verified it — else a new account. Then it's like any sign-in:
// recorded, and a Continuum session for the page.
//
// Settings (only when they're all set does the Google button show):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (a secret)  an OAuth client of type
//     "Web application" in the Google Cloud console
//   GOOGLE_CALLBACK_URL  this API's /auth/google/callback, registered on that client

import { Router } from "express";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { dir } from "../directory/directory.js";
import { clientAuthCallbackUrl, clientPageUrl } from "../config/urls.js";

const router = Router();

const STATES = "google_signin_states";
const STATE_MS = 10 * 60_000;
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

/** Is Sign in with Google set up here? */
export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);

/** Back to the sign-in card, saying why it didn't work. */
const fail = (res, why) => res.redirect(clientPageUrl(`/signin?error=${encodeURIComponent(why)}`));

router.get("/", async (req, res) => {
  if (!googleConfigured()) return fail(res, "Sign in with Google isn't set up here yet.");
  const state = randomBytes(24).toString("hex");
  const db = getDB();
  await db.collection(STATES).createIndex({ createdAt: 1 }, { expireAfterSeconds: STATE_MS / 1000 }).catch(() => {});
  await db.collection(STATES).insertOne({ state, createdAt: new Date() });
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account"); // choose which Google account, every time
  res.redirect(url.toString());
});

router.get("/callback", async (req, res) => {
  if (!googleConfigured()) return fail(res, "Sign in with Google isn't set up here yet.");
  const { code, state, error } = req.query;
  if (error) return fail(res, error === "access_denied" ? "You didn't let Continuum sign you in with Google." : "Google didn't sign you in.");

  const db = getDB();
  // The state we made, used once and only for a short while (a sign-in started here, not elsewhere)
  const started = typeof state === "string" && state ? await db.collection(STATES).findOneAndDelete({ state }) : null;
  if (!started || Date.now() - started.createdAt.getTime() > STATE_MS) return fail(res, "That sign-in link has expired. Try again.");
  if (typeof code !== "string" || !code) return fail(res, "Google didn't sign you in.");

  try {
    // The code → tokens (server to server, with the client secret)
    const tokenRes = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: process.env.GOOGLE_CALLBACK_URL, grant_type: "authorization_code" }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.access_token) {
      req.log.warn({ status: tokenRes.status, error: tokens.error }, "Google sign-in: code not accepted");
      return fail(res, "Google didn't sign you in. Try again.");
    }
    const infoRes = await fetch(USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const g = await infoRes.json().catch(() => ({}));
    if (!infoRes.ok || !g.sub) return fail(res, "Google didn't say who you are. Try again.");
    if (!g.email || g.email_verified !== true) return fail(res, "Your Google account's email isn't verified, so Continuum can't use it.");
    const email = String(g.email).toLowerCase();
    const profile = { email, name: g.name ?? null, picture: g.picture ?? null };

    const users = db.collection("users");
    // 1. The Google account linked before; 2. the account with this (Google-verified) address; 3. a new one
    const linked = await dir.userFor("google", g.sub);
    let user = linked ? await users.findOne({ _id: new ObjectId(linked) }) : null;
    if (!user) user = await users.findOne({ email }, { collation: { locale: "en", strength: 2 } });
    if (!user) {
      const now = new Date();
      const { insertedId } = await users.insertOne({ email, google: { name: profile.name, picture: profile.picture }, createdAt: now, updatedAt: now });
      const { insertedId: executionStateId } = await db.collection("execution_state").insertOne({ userId: insertedId, activeProjectId: null, createdAt: now, updatedAt: now });
      await users.updateOne({ _id: insertedId }, { $set: { executionStateId } });
      user = { _id: insertedId, email };
      // In the directory as a human, with the default role for new users
      await dir.registerHuman({ id: String(insertedId), email, displayName: profile.name, createdAt: now });
      req.log.info({ userId: String(insertedId) }, "Google sign-in made an account");
    }
    await dir.link(String(user._id), "google", g.sub, profile);

    const access = await dir.accessFor(String(user._id));
    if (access?.disabled) {
      await dir.recordLogin({ userId: user._id, email, method: "google", ok: false, reason: "account disabled", req }).catch(() => {});
      return fail(res, "This account is disabled. Ask your admin.");
    }
    const token = jwt.sign({ userId: user._id, email: user.email || email, authProvider: "google", tv: await dir.sessionVersion(String(user._id)) }, process.env.JWT_SECRET, { expiresIn: "7d" });
    await dir.recordLogin({ userId: user._id, email, method: "google", req }).catch(() => {});
    res.redirect(clientAuthCallbackUrl(token));
  } catch (err) {
    req.log.error({ err }, "Google sign-in failed");
    fail(res, "Google sign-in didn't work. Try again.");
  }
});

export default router;
