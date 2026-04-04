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
 */
router.get("/github/callback", async (req, res) => {
    const { code } = req.query;

    try {
        const db = getDB();
        const users = db.collection("users");
        const sessions = db.collection("sessions");

        const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
        const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
        const JWT_SECRET = process.env.JWT_SECRET;

        /**
         * 1️⃣ Exchange code → access token
         */
        const tokenRes = await fetch(
            "https://github.com/login/oauth/access_token",
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code,
                }),
            }
        );

        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            console.error("TOKEN ERROR:", tokenData);
            return res.status(400).send("GitHub token exchange failed");
        }

        const access_token = tokenData.access_token;

        /**
         * 2️⃣ Fetch GitHub user
         */
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${access_token}`,
                Accept: "application/json",
            },
        });

        const githubUser = await userRes.json();

        console.log("GITHUB USER:", githubUser);

        /**
         * 3️⃣ Fetch emails
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
                emails.find((e) => e.primary)?.email ||
                emails[0]?.email;
        } else {
            console.error("EMAIL FETCH FAILED:", emails);
            primaryEmail = githubUser.email;
        }

        /**
         * 4️⃣ Resolve or create user
         */
        let dbUser = await users.findOne({ githubId: githubUser.id });

        const execution = db.collection("execution_state");

        if (!dbUser) {
            // 1️⃣ Create user
            const result = await users.insertOne({
                githubId: githubUser.id,
                email: primaryEmail,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const userId = result.insertedId;

            // 2️⃣ Create execution state
            const executionStateDoc = {
                userId,
                activeProjectId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const { insertedId: executionStateId } =
                await execution.insertOne(executionStateDoc);

            // 3️⃣ Link execution state to user
            await users.updateOne(
                { _id: userId },
                {
                    $set: { executionStateId },
                }
            );

            dbUser = {
                _id: userId,
                githubId: githubUser.id,
                email: primaryEmail,
                executionStateId,
            };
        }

        /**
         * 5️⃣ Store GitHub access token
         */
        await users.updateOne(
            { _id: dbUser._id },
            {
                $set: {
                    githubAccessToken: access_token,
                },
            }
        );

        /**
         * 6️⃣ Check existing session
         */
        const existingSession = await sessions.findOne({
            userId: dbUser._id,
        });

        if (existingSession) {
            try {
                jwt.verify(existingSession.token, JWT_SECRET);

                return res.redirect(
                    `http://localhost:45173/auth/callback?token=${existingSession.token}`
                );
            } catch {
                // expired → continue
            }
        }

        /**
         * 7️⃣ Generate JWT
         */
        const token = jwt.sign(
            {
                userId: dbUser._id,
                email: primaryEmail,
                authProvider: "github",
            },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        /**
         * 8️⃣ Store session
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
         * 9️⃣ Redirect to frontend
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