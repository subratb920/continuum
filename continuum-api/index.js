import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

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

const mongoUrl =
  process.env.MONGO_URL || "mongodb://localhost:27000/continuum";

const client = new MongoClient(mongoUrl);
await client.connect();

const db = client.db("continuum");

const projects = db.collection("projects");
const bridges = db.collection("bridges");
const executionState = db.collection("execution_state");

/* --------------------------------------------------
   PROJECTS
-------------------------------------------------- */

app.post("/projects", async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Project name required" });
  }

  const project = {
    name: name.trim(),
    createdAt: new Date(),
    activeBridgeId: null,
    bridgeCount: 0,
  };

  const result = await projects.insertOne(project);
  res.json({ ...project, _id: result.insertedId });
});

app.get("/projects", async (req, res) => {
  const list = await projects.find().toArray();
  res.json(list);
});

/* --------------------------------------------------
   EXECUTION STATE (SINGLE USER CONTINUUM)
-------------------------------------------------- */

/**
 * Get currently active project
 */
app.get("/execution/active-project", async (req, res) => {
  const state = await executionState.findOne({ _id: "continuum" });

  res.json({
    activeProjectId: state?.activeProjectId || null,
  });
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
    },
    { upsert: true }
  );

  res.sendStatus(204);
});

/* --------------------------------------------------
   BRIDGES
-------------------------------------------------- */

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

  /* 🔒 EXECUTION INVARIANT
     Only the active project may start an interval
  */
  const state = await executionState.findOne({ _id: "continuum" });

  if (
    !state?.activeProjectId ||
    !state.activeProjectId.equals(project._id)
  ) {
    return res.status(403).json({
      error: "Project is not the active execution project",
    });
  }

  // Sequential bridge index per project
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

  // Persist continuity
  await projects.updateOne(
    { _id: project._id },
    {
      $set: { activeBridgeId: result.insertedId },
      $inc: { bridgeCount: 1 },
    }
  );

  res.json({ ...bridge, _id: result.insertedId });
});

/**
 * Update bridge (draft → finalized, goal statuses, etc.)
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
