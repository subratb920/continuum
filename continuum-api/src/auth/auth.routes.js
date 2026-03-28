import { Router } from "express";
import { signup, login } from "./auth.controller.js";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);

router.get("/github", (req, res) => {
    const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
    const redirect = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=user:email`;
    res.redirect(redirect);
});

router.get("/github/callback", async (req, res) => {
    const { code } = req.query;

    try {
        const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
        const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
        const JWT_SECRET = process.env.JWT_SECRET;

        // Exchange code → token
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

        // Get user
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${access_token}`,
                Accept: "application/json",
            },
        });

        const user = await userRes.json();

        // Get email
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

            // fallback if GitHub didn't return array
            primaryEmail = user.email;
        }

        // ⚠️ TEMP: no DB yet (or plug your DB here)
        const fakeUserId = user.id;

        const token = jwt.sign(
            { userId: fakeUserId, email: primaryEmail },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        // Redirect to frontend
        res.redirect(
            `http://localhost:45173/auth/callback?token=${token}`
        );
    } catch (err) {
        console.error("GITHUB CALLBACK ERROR:", err);
        res.status(500).send(err.message || "GitHub auth failed");
    }
});


export default router;
