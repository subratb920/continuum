import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { connectToDB } from "./src/config/db.js";

const app = express();

/* --------------------------------------------------
   Middleware
-------------------------------------------------- */

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

/* --------------------------------------------------
   MongoDB
-------------------------------------------------- */


const db = await connectToDB();

const projects = db.collection("projects");
const bridges = db.collection("bridges");
const executionState = db.collection("execution_state");

/* --------------------------------------------------
   BOOTSTRAP EXECUTION STATE (SINGLETON)
-------------------------------------------------- */

await executionState.updateOne(
  { _id: "continuum" },
  {
    $setOnInsert: {
      activeProjectId: null,
      updatedAt: new Date(),
    },
  },
  { upsert: true }
);

/* --------------------------------------------------
   Create a new PROJECT
-------------------------------------------------- */

app.post("/projects", async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Project name required" });
  }

  const project = {
    name: name.trim(),
    createdAt: new Date(),
    bridgeCount: 0,
  };

  const result = await projects.insertOne(project);
  res.json({ ...project, _id: result.insertedId });
});

app.get("/projects", async (req, res) => {
  const list = await projects.find().toArray();
  res.json(list);
});

app.get("/projects/:id", async (req, res) => {
  const { id } = req.params;

  const project = await projects.findOne({
    _id: new ObjectId(id),
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  res.json(project);
});

/* --------------------------------------------------
   EXECUTION STATE (SINGLE USER CONTINUUM)
-------------------------------------------------- */

/**
 * Get currently active project (full object)
 */
app.get("/execution/active-project", async (req, res) => {
  const state = await executionState.findOne({ _id: "continuum" });

  if (!state?.activeProjectId) {
    console.log("No active project");
    return res.json({ activeProject: null });
  }

  const project = await projects.findOne({
    _id: state.activeProjectId,
  });
  console.log("Active project:", project);
  res.json({ activeProject: project || null });
});

/**
 * Activate a project (exclusive)
 */
app.post("/execution/activate-project", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: "projectId required" });
  }

  const project = await projects.findOne({
    _id: new ObjectId(projectId),
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  await executionState.updateOne(
    { _id: "continuum" },
    {
      $set: {
        activeProjectId: project._id,
        updatedAt: new Date(),
      },
    }
  );

  res.sendStatus(204);
});

/**
 * Deactivate current project
 */
app.post("/execution/deactivate-project", async (req, res) => {
  await executionState.updateOne(
    { _id: "continuum" },
    {
      $set: {
        activeProjectId: null,
        updatedAt: new Date(),
      },
    }
  );

  res.sendStatus(204);
});


/* --------------------------------------------------
   DELETE PROJECT (CASCADE)
-------------------------------------------------- */

app.delete("/projects/:id", async (req, res) => {
  const { id } = req.params;

  let projectId;
  try {
    projectId = new ObjectId(id);
  } catch {
    return res.status(400).json({ error: "Invalid project id" });
  }

  const project = await projects.findOne({ _id: projectId });
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // 1️⃣ Delete all bridges for this project
  await bridges.deleteMany({ projectId });

  // 2️⃣ Delete the project itself
  await projects.deleteOne({ _id: projectId });

  // 3️⃣ Clear execution state if this project was active
  const state = await executionState.findOne({ _id: "continuum" });

  if (state?.activeProjectId?.equals(projectId)) {
    await executionState.updateOne(
      { _id: "continuum" },
      {
        $set: {
          activeProjectId: null,
          updatedAt: new Date(),
        },
      }
    );
  }

  res.sendStatus(204);
});



/* --------------------------------------------------
   BRIDGES (INTERVALS)
-------------------------------------------------- */

/**
 * Start a new interval (bridge)
 * 🔒 Only active project may start
 * 🔒 Only one draft at a time
 */
app.post("/bridges/start", async (req, res) => {
  const { projectId, interval, sessionGoals } = req.body;

  if (!projectId || !interval || !sessionGoals?.length) {
    return res.status(400).json({ error: "Invalid bridge payload" });
  }

  const project = await projects.findOne({
    _id: new ObjectId(projectId),
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const state = await executionState.findOne({ _id: "continuum" });

  if (
    !state?.activeProjectId ||
    !state.activeProjectId.equals(project._id)
  ) {
    return res.status(403).json({
      error: "Project is not the active execution project",
    });
  }

  // 🔒 Prevent multiple active drafts
  const existingDraft = await bridges.findOne({
    projectId: project._id,
    status: "draft",
  });

  if (existingDraft) {
    return res.status(409).json({
      error: "An active interval already exists",
    });
  }

  const count = await bridges.countDocuments({
    projectId: project._id,
  });

  const index = count + 1;

  const bridge = {
    projectId: project._id,
    index,
    name: `bridge-${index}`,
    status: "draft",

    interval: {
      ...interval,
      startedAt: new Date(),
    },

    sessionGoals: sessionGoals.map((text, i) => ({
      id: `g${i + 1}`,
      text,
      status: "untouched",
    })),

    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await bridges.insertOne(bridge);

  await projects.updateOne(
    { _id: project._id },
    { $inc: { bridgeCount: 1 } }
  );

  res.json({ ...bridge, _id: result.insertedId });
});

/**
 * Update bridge (finalize, goal updates, etc.)
 */
app.patch("/bridges/:id", async (req, res) => {
  const { id } = req.params;

  await bridges.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...req.body,
        updatedAt: new Date(),
      },
    }
  );

  res.sendStatus(204);
});

/**
 * Fetch bridges for a project (chronological)
 */
app.get("/projects/:id/bridges", async (req, res) => {
  const { id } = req.params;

  const list = await bridges
    .find({ projectId: new ObjectId(id) })
    .sort({ index: 1 }) // oldest → newest
    .toArray();

  res.json(list);
});

/* --------------------------------------------------
   SERVER
-------------------------------------------------- */

app.listen(4000, () => {
  console.log("Continuum API running on port 4000");
});
