import fetch from "node-fetch";
import jwt from "jsonwebtoken";

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

export function registerGithubAuth(app, db) {
  // STEP 1 → Redirect user to GitHub
  app.get("/auth/github", (req, res) => {
    const redirect = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=user:email`;

    res.redirect(redirect);
  });

  // STEP 2 → GitHub callback
  app.get("/auth/github/callback", async (req, res) => {
    const { code } = req.query;

    try {
      // Exchange code → access token
      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
          }),
        }
      );

      const tokenData = await tokenRes.json();
      const access_token = tokenData.access_token;

      // Fetch user
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      const user = await userRes.json();

      // Fetch email (important)
      const emailRes = await fetch(
        "https://api.github.com/user/emails",
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      );

      const emails = await emailRes.json();
      const primaryEmail = emails.find((e) => e.primary)?.email;

      // Save or find user
      const users = db.collection("users");

      let existingUser = await users.findOne({
        githubId: user.id,
      });

      if (!existingUser) {
        const newUser = {
          githubId: user.id,
          email: primaryEmail,
          createdAt: new Date(),
        };

        const result = await users.insertOne(newUser);
        existingUser = { ...newUser, _id: result.insertedId };
      }

      // Create JWT
      const token = jwt.sign(
        { userId: existingUser._id },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Redirect back to frontend
      res.redirect(
        `http://localhost:45173/auth/callback?token=${token}`
      );
    } catch (err) {
      console.error(err);
      res.status(500).send("GitHub auth failed");
    }
  });
}