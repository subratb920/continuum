import { Router } from "express";
import { signup, login } from "./auth.controller.js";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { getDB } from "../config/db.js";

const router = Router();

/**
 * Basic auth routes
 */
router.post("/signup", signup);
router.post("/login", login);

/**
 * Step 1: Redirect user to GitHub OAuth
 */
router.get("/github", (req, res) => {
    const CLIENT_ID = process.env.GITHUB_CLIENT_ID;

    const redirect = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=user:email`;

    res.redirect(redirect);
});

/**
 * Step 2: GitHub OAuth callback
 *
 * IMPORTANT:
 * - DB is accessed ONLY at runtime (after bootstrap)
 * - Ensures system lifecycle correctness
 */
router.get("/github/callback", async (req, res) => {
    const { code } = req.query;

    try {
        // ✅ SAFE: DB accessed after initialization
        const db = getDB();
        const users = db.collection("users");
        const sessions = db.collection("sessions");

        const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
        const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
        const JWT_SECRET = process.env.JWT_SECRET;

        /**
         * 1️⃣ Exchange GitHub code → access token
         */
        const tokenRes = await fetch(
            "https://github.com/login/oauth/access_token",
            {
                method: "POST",
                headers: { Accept: "application/json" },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code,
                }),
            }
        );

        const tokenData = await tokenRes.json();
        const access_token = tokenData.access_token;

        /**
         * 2️⃣ Fetch GitHub user profile
         */
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${access_token}`,
                Accept: "application/json",
            },
        });

        const githubUser = await userRes.json();

        /**
         * 3️⃣ Fetch user emails
         * GitHub may not include email in profile
         */
        const emailRes = await fetch(
            "https://api.github.com/user/emails",
            {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    Accept: "application/json",
                },
            }
        );

        const emails = await emailRes.json();

        let primaryEmail;

        if (Array.isArray(emails)) {
            primaryEmail =
                emails.find(e => e.primary)?.email ||
                emails[0]?.email;
        } else {
            console.error("EMAIL FETCH FAILED:", emails);
            primaryEmail = githubUser.email;
        }

        /**
         * 4️⃣ Resolve or create user
         */
        let dbUser = await users.findOne({ githubId: githubUser.id });

        if (!dbUser) {
            const result = await users.insertOne({
                githubId: githubUser.id,
                email: primaryEmail,
                createdAt: new Date(),
            });

            dbUser = {
                _id: result.insertedId,
                githubId: githubUser.id,
                email: primaryEmail,
            };
        }

        /**
         * 5️⃣ Check existing session
         * Reuse token if still valid
         */
        const existingSession = await sessions.findOne({
            userId: dbUser._id,
        });

        if (existingSession) {
            try {
                // ✅ Validate token expiry
                jwt.verify(existingSession.token, JWT_SECRET);

                return res.redirect(
                    `http://localhost:45173/auth/callback?token=${existingSession.token}`
                );
            } catch {
                // Token expired → proceed to create new
            }
        }

        /**
         * 6️⃣ Generate new JWT token
         */
        const token = jwt.sign(
            { userId: dbUser._id, email: primaryEmail },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        /**
         * 7️⃣ Store session (single active session per user)
         */
        await sessions.updateOne(
            { userId: dbUser._id },
            {
                $set: {
                    token,
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );

        /**
         * 8️⃣ Redirect to frontend with token
         */
        res.redirect(
            `http://localhost:45173/auth/callback?token=${token}`
        );

    } catch (err) {
        console.error("GITHUB CALLBACK ERROR:", err);
        res.status(500).send(err.message || "GitHub auth failed");
    }
});

export default router;