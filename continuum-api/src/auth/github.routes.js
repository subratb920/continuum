import { Router } from "express";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";
import { createProjectDoc } from "../models/project.model.js";
import { createProjectService } from "../services/project.service.js";

const router = Router();

// Safety cap: 10 pages × 100 = up to 1000 repositories
const MAX_REPO_PAGES = 10;

router.get("/repos", async (req, res) => {
    try {
        const db = getDB();
        const users = db.collection("users");

        const userId = req.user.id; // assuming auth middleware

        const user = await users.findOne({ _id: new ObjectId(userId) });

        if (!user?.githubAccessToken) {
            return res.status(400).json({ message: "GitHub not connected" });
        }

        // All repos the user can access (public + private, owned,
        // collaborator and organisation), newest activity first.
        // GitHub returns at most 100 per page, so follow the pages.
        const repos = [];

        for (let page = 1; page <= MAX_REPO_PAGES; page++) {
            const url =
                "https://api.github.com/user/repos" +
                `?per_page=100&page=${page}&sort=updated` +
                "&affiliation=owner,collaborator,organization_member";

            const githubRes = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${user.githubAccessToken}`,
                    Accept: "application/json",
                },
            });

            if (!githubRes.ok) {
                const body = await githubRes.json().catch(() => ({}));
                console.error("GITHUB REPOS ERROR:", githubRes.status, body);
                return res.status(400).json({
                    message: "Couldn't load your GitHub repositories. Sign in with GitHub again.",
                });
            }

            const batch = await githubRes.json();
            repos.push(...batch);

            if (batch.length < 100) break;
        }

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