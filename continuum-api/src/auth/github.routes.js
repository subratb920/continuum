import { Router } from "express";
import fetch from "node-fetch";
import { getDB } from "../config/db.js";
import { ObjectId } from "mongodb";
import { createProjectDoc } from "../models/project.model.js";
import { createProjectService } from "../services/project.service.js";
import { githubAuthorizeUrl } from "../config/urls.js";
import { GITHUB_SCOPE, newConnectState } from "./githubConnect.js";

const router = Router();

/** Connect GitHub to the signed-in account (whatever its email or sign-in): GitHub's page to go to. */
router.post("/connect", async (req, res) => {
    res.json({ url: githubAuthorizeUrl(GITHUB_SCOPE, await newConnectState(getDB(), req.user.id)) });
});

// Safety cap: 10 pages × 100 = up to 1000 repositories
const MAX_REPO_PAGES = 10;

router.get("/repos", async (req, res) => {
    try {
        const db = getDB();
        const users = db.collection("users");

        const userId = req.user.id; // assuming auth middleware

        const user = await users.findOne({ _id: new ObjectId(userId) });

        if (!user?.githubAccessToken) {
            return res.status(400).json({ message: "GitHub not connected", code: "GITHUB_NOT_CONNECTED" });
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
                    message: "Couldn't load your GitHub repositories. Connect GitHub again.",
                    code: "GITHUB_NOT_CONNECTED",
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
        const { repos, departmentIds } = req.body;

        if (!repos || repos.length === 0) {
            return res.status(400).json({ message: "No repos selected" });
        }

        const created = [];

        for (const repo of repos) {
            // Into the space you're working in (an organization's: with the departments chosen)
            const id = await projectService.createProjectFromGithub(
                userId,
                repo,
                req.space,
                { departmentIds }
            );
            created.push(id);
        }

        res.json({ message: "Projects imported successfully", count: created.length });
    } catch (err) {
        if (err.isOperational) return res.status(err.statusCode).json({ message: err.message, error: err.message, code: err.code });
        console.error(err);
        res.status(500).json({ message: "Import failed" });
    }
});

// A repository's files (GitHub's tarball of its default branch, or ?ref=), streamed
// to the browser, which writes them into a new folder on the user's device.
// Read with the user's own GitHub sign-in; nothing is stored here.
const MAX_TARBALL_BYTES = 200 * 1024 * 1024;

router.get("/repos/:owner/:repo/tarball", async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const ref = typeof req.query.ref === "string" ? req.query.ref : "";
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || (ref && !/^[A-Za-z0-9_./-]+$/.test(ref))) {
            return res.status(400).json({ message: "Not a valid repository." });
        }

        const db = getDB();
        const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
        if (!user?.githubAccessToken) {
            return res.status(400).json({ message: "GitHub not connected", code: "GITHUB_NOT_CONNECTED" });
        }

        const githubRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball${ref ? `/${encodeURIComponent(ref)}` : ""}`, {
            headers: { Authorization: `Bearer ${user.githubAccessToken}`, Accept: "application/vnd.github+json", "User-Agent": "continuum-api" },
            redirect: "follow",
        });
        if (!githubRes.ok) {
            return res.status(githubRes.status === 404 ? 404 : 502).json({
                message: githubRes.status === 404 ? "GitHub doesn't show this repository to your sign-in." : "GitHub couldn't send the repository.",
            });
        }
        const declared = Number(githubRes.headers.get("content-length") || 0);
        if (declared > MAX_TARBALL_BYTES) {
            return res.status(413).json({ message: "This repository is too large to copy (over 200 MB)." });
        }

        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Cache-Control", "no-store");
        let sent = 0;
        githubRes.body.on("data", (chunk) => {
            sent += chunk.length;
            if (sent > MAX_TARBALL_BYTES) githubRes.body.destroy(new Error("too large"));
        });
        githubRes.body.on("error", () => res.destroy());
        githubRes.body.pipe(res);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ message: "The repository couldn't be read." });
    }
});

export default router;