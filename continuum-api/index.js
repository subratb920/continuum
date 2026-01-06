import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(cors());

app.use(express.json());

const mongoUrl =
  process.env.MONGO_URL || "mongodb://localhost:27000/continuum";

const client = new MongoClient(mongoUrl);
await client.connect();

const db = client.db("continuum");
const projects = db.collection("projects");
const bridges = db.collection("bridges");

/* ---------------- Projects ---------------- */

app.post("/projects", async (req, res) => {
  const { name } = req.body;

  const project = {
    name,
    createdAt: new Date(),
    activeBridgeId: null,
    bridgeCount: 0
  };

  const result = await projects.insertOne(project);
  res.json({ ...project, _id: result.insertedId });
});

app.get("/projects", async (req, res) => {
  res.json(await projects.find().toArray());
});

/* ---------------- Bridges ---------------- */

app.post("/bridges/start", async (req, res) => {
  const { projectId, interval, sessionGoals } = req.body;

  const project = await projects.findOne({
    _id: new ObjectId(projectId),
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // 🔒 Increment bridge counter atomically
  const nextIndex = (project.bridgeCount || 0) + 1;

  const count = await bridges.countDocuments({
  projectId: new ObjectId(projectId)
});

  const bridge = {
    projectId: new ObjectId(projectId),
    index: count + 1,
    name: `bridge-${count + 1}`, // ✅ AUTO-GENERATED
    status: "draft",
    interval: {
      ...interval,
      startedAt: new Date(),
    },
    sessionGoals: sessionGoals.map((g, i) => ({
      id: `g${i + 1}`,
      text: g,
      status: "untouched",
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await bridges.insertOne(bridge);

  // 🔒 Persist continuity update
  await projects.updateOne(
    { _id: project._id },
    {
      $set: { activeBridgeId: result.insertedId },
      $inc: { bridgeCount: 1 },
    }
  );

  res.json({ ...bridge, _id: result.insertedId });
});


app.patch("/bridges/:id", async (req, res) => {
  const { id } = req.params;
  console.log("Received patchBridge request:", req.body);
  await bridges.updateOne(
    { _id: new ObjectId(id) },
    { $set: { ...req.body, updatedAt: new Date() } }
  );

  res.sendStatus(204);
  // console.log("Updated bridge:", id, req.body);
});

app.get("/projects/:id/bridges", async (req, res) => {
  const { id } = req.params;
  console.log("Received fetchBridges request for project:", id);
  const list = await bridges
    .find({ projectId: new ObjectId(id) })
    .sort({ "interval.startedAt": 1 })
    .toArray();
  // console.log("Fetched bridges:", list);
  res.json(list);
});

/* ---------------- Start Server ---------------- */

app.listen(4000, () => {
  console.log("Continuum API running on port 4000");
});