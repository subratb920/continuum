import { Router } from "express";
import { signup, login } from "./auth.controller.js";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { getDB } from "../config/db.js";
import { clientAuthCallbackUrl, githubAuthorizeUrl, githubCallbackUrl } from "../config/urls.js";

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
    // "repo" is needed to list private repositories (OAuth Apps have no
    // read-only private scope); Continuum only reads the repo list.
    res.redirect(githubAuthorizeUrl("user:email repo"));
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
                    // The same return address the sign-in used (GitHub checks they match)
                    ...(githubCallbackUrl() ? { redirect_uri: githubCallbackUrl() } : {}),
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
            req.log.info(
                {
                    githubId: githubUser.id,
                    dbUserId: userId,
                },
                "GitHub login created user"
            );

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
         * 4b A user whose first sign-in stopped half way (saved without its
         * execution state): finish it now.
         */
        if (!dbUser.executionStateId) {
            const existing = await execution.findOne({ userId: dbUser._id });
            const executionStateId = existing?._id ?? (await execution.insertOne({
                userId: dbUser._id,
                activeProjectId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            })).insertedId;
            await users.updateOne({ _id: dbUser._id }, { $set: { executionStateId } });
            dbUser = { ...dbUser, executionStateId };
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

                return res.redirect(clientAuthCallbackUrl(existingSession.token));
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
        res.redirect(clientAuthCallbackUrl(token));

    } catch (err) {
        console.error("GITHUB CALLBACK ERROR:", err);
        res.status(500).send(err.message || "GitHub auth failed");
    }
});

export default router;