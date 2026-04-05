import { Router } from "express";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";
import { createProjectDoc } from "../models/project.model.js";
import { createProjectService } from "../services/project.service.js";

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

router.post("/import", async (req, res) => {
    try {
        const db = getDB();
        const projectService = await createProjectService(db);

        const userId = req.user.id;
        const { repos } = req.body;

        if (!repos || repos.length === 0) {
            return res.status(400).json({ message: "No repos selected" });
        }

        const created = [];

        for (const repo of repos) {
            const id = await projectService.createProjectFromGithub(
                userId,
                repo
            );
            created.push(id);
        }

        res.json({ message: "Projects imported successfully", count: created.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Import failed" });
    }
});

export default router;