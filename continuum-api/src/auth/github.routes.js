import { Router } from "express";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";

const router = Router();

router.get("/repos", async (req, res) => {
  try {
    const db = getDB();
    const users = db.collection("users");

    const userId = req.user.id; // assuming auth middleware

    const user = await users.findOne({ _id: new ObjectId(userId) });

    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: "GitHub not connected" });
    }

    const githubRes = await fetch(
      "https://api.github.com/user/repos",
      {
        headers: {
          Authorization: `Bearer ${user.githubAccessToken}`,
          Accept: "application/json",
        },
      }
    );

    const repos = await githubRes.json();

    res.json(repos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch repos" });
  }
});

export default router;