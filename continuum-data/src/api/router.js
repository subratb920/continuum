import express from "express";
import { ObjectId } from "mongodb";
import { DataError, badRequest, conflict, notFound } from "../errors.js";
import { oid, hex } from "../ids.js";
import { enqueue } from "../store/queue.js";
import { buildSteps, createRun, eventView, exportSteps, FINAL, pipelineSteps, runView, updateRun, addEvent } from "../runs.js";
import { EXPORT_FORMATS, normaliseSteps, STEP_CATALOG, suggestSteps, TEMPLATES } from "../recipes.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { saveSources, searchSources, sourceView } from "../catalogue/index.js";
import { licenceInfo } from "../catalogue/licences.js";
import { readRows } from "./rows.js";
import { STEP_LABEL as STEP_LABELS } from "../worker/handlers.js";

/**
 * The /data routes (spec 6). Every route needs Continuum sign-in (the host's
 * `auth`, which sets req.user.id) and only ever sees that user's things.
 *
 *   GET    /me                         limits and usage
 *   GET    /sources?q=&modality=&task=&live=1
 *   GET    /sources/:id                 one source (with its subsets and splits)
 *   POST   /sources                     { url } or { connector, ref }: adds a source to the catalogue
 *   GET    /credentials   POST /credentials/:kind { value }   DELETE /credentials/:kind
 *   POST   /uploads                     { name } → { uploadId }
 *   POST   /uploads/:id/files?path=     one file, as the request body
 *   GET    /datasets   POST /datasets   { name, goal, sourceId | uploadId, config, split, options }
 *   GET    /datasets/:id   PATCH   DELETE
 *   GET    /datasets/:id/versions
 *   GET    /versions/:id   /versions/:id/rows?offset=&limit=   /versions/:id/profile
 *   GET    /recipes/catalog   GET /recipes/templates   GET /recipes   POST /recipes   PATCH /recipes/:id   DELETE /recipes/:id
 *   GET    /datasets/:id/suggested-recipe
 *   GET    /versions/:id/changes   /versions/:id/quality
 *   POST   /versions/:id/publish
 *   POST   /versions/:id/exports { format }   GET /versions/:id/exports/:format/download
 *   POST   /runs                         { datasetId, inputVersionId, steps | recipeId }  a clean-up pipeline
 *   GET    /runs?datasetId=   GET /runs/:id   POST /runs/:id/cancel   POST /runs/:id/retry
 *   GET    /runs/:id/events?afterSeq=
 *   GET    /events                      live run events (server-sent events)
 */
const MAX_UPLOAD_FILES = 5000;
const NAME_MAX = 80;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cleanName(value, what = "name") {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s) throw badRequest(`Give it a ${what}.`, "NAME_REQUIRED");
  if (s.length > NAME_MAX) throw badRequest(`Keep the ${what} under ${NAME_MAX} characters.`, "NAME_TOO_LONG");
  return s;
}

/** A relative path inside an upload: plain segments only. */
function cleanUploadPath(value) {
  const parts = String(value ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || p.length > 200 || /[\0]/.test(p))) throw badRequest("That file path isn't allowed.", "BAD_PATH");
  return parts.join("/");
}

export function datasetView(d, { source = null, run = null } = {}) {
  return {
    id: String(d._id),
    name: d.name,
    goal: d.goal ?? "",
    modality: d.modality ?? null,
    task: d.task ?? null,
    state: d.state,
    rows: d.rows ?? null,
    versionCount: d.versionCount ?? 0,
    headVersionId: hex(d.headVersionId),
    publishedVersionId: hex(d.publishedVersionId),
    source: source ? { id: String(source._id), title: source.title, connector: source.connector, ref: source.connector === "upload" ? null : source.ref, licence: licenceInfo(source.licence) } : null,
    lastRun: run ? runView(run) : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function versionView(v) {
  return {
    id: String(v._id),
    datasetId: String(v.datasetId),
    number: v.number,
    rows: v.rows,
    bytes: v.bytes,
    modality: v.modality,
    task: v.task,
    schema: v.schema,
    splits: v.splits,
    labels: v.labels,
    profileSummary: v.profileSummary,
    quality: v.quality,
    licences: v.licences,
    frozen: v.frozen,
    parentVersionId: hex(v.parentVersionId),
    changes: v.changes ?? null,
    exports: Object.fromEntries(Object.entries(v.exports ?? {}).map(([f, e]) => [f, { bytes: e.bytes, at: e.at }])),
    madeBy: { op: v.madeBy?.op ?? null, runId: hex(v.madeBy?.runId), params: v.madeBy?.params ?? null },
    createdAt: v.createdAt,
  };
}

export function createDataRouter({ engine, auth }) {
  const router = express.Router();
  const { cfg, storage, connectors } = engine;
  const db = () => engine.db;
  const col = (name) => engine.db.collection(name);

  router.use((req, res, next) => (engine.ready ? next() : res.status(503).json({ error: "Data isn't ready yet. Try again in a moment.", code: "DATA_STARTING" })));
  router.use(auth);
  router.use((req, res, next) => {
    req.userId = oid(req.user?.id, "user");
    next();
  });

  // Every lookup is by id and owner, so another user's id is simply "not found"
  async function mine(name, id, userId, what) {
    const doc = await col(name).findOne({ _id: oid(id, what.replace(/^That /, "").toLowerCase()), userId });
    if (!doc) throw notFound(what);
    return doc;
  }

  async function usage(userId) {
    const [bytes, active] = await Promise.all([storage.usage(userId), col("runs").countDocuments({ userId, state: { $nin: FINAL } })]);
    return { bytes, runsActive: active };
  }

  // ---------- Me ----------

  router.get("/me", wrap(async (req, res) => {
    const u = await usage(req.userId);
    res.json({ limits: cfg.limits, usage: u });
  }));

  // ---------- Tokens for sources (sealed; only the last four characters come back) ----------

  router.get("/credentials", wrap(async (req, res) => {
    res.json({ credentials: await engine.credentials.list(req.userId), canSave: Boolean(cfg.secretKey) });
  }));

  router.post("/credentials/:kind", express.json(), wrap(async (req, res) => {
    const saved = await engine.credentials.put(req.userId, req.params.kind, req.body?.value);
    await col("audit_events").insertOne({ userId: req.userId, at: new Date(), action: "credential.save", target: null, details: { kind: req.params.kind } });
    res.json({ credential: { ...saved, saved: true } });
  }));

  router.delete("/credentials/:kind", wrap(async (req, res) => {
    await engine.credentials.remove(req.userId, req.params.kind);
    await col("audit_events").insertOne({ userId: req.userId, at: new Date(), action: "credential.remove", target: null, details: { kind: req.params.kind } });
    res.status(204).end();
  }));

  // ---------- Sources ----------

  router.get("/sources", wrap(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 200);
    const modality = req.query.modality ? String(req.query.modality) : null;
    const task = req.query.task ? String(req.query.task) : null;
    let liveError = null;
    if (q && req.query.live === "1") {
      // Every source that can search, at once; one that doesn't answer doesn't hold up the rest
      const token = await engine.credentials.reveal(req.userId, "kaggle").catch(() => null);
      const searches = ["huggingface", "openml", "uci", "kaggle"].map(async (id) => {
        try {
          const found = await connectors[id].search({ q, modality, limit: 20, token });
          await saveSources(db(), found, "search");
          return null;
        } catch (e) {
          return e instanceof DataError ? e.message : `${id} didn't answer.`;
        }
      });
      const errors = (await Promise.all(searches)).filter(Boolean);
      if (errors.length === 4) liveError = "The online search didn't answer.";
    }
    res.json({ sources: await searchSources(db(), req.userId, { q, modality, task }), liveError });
  }));

  router.get("/sources/:id", wrap(async (req, res) => {
    const s = await col("sources").findOne({ _id: oid(req.params.id, "source"), $or: [{ ownerUserId: null }, { ownerUserId: req.userId }] });
    if (!s) throw notFound("That source");
    const view = sourceView(s);
    if (s.connector === "huggingface") {
      const d = await connectors.huggingface.describe(s.ref);
      view.configs = d.configs.map((c) => ({ name: c.name, labelNames: c.labelNames ?? null, columns: c.columns ?? null, splits: c.splits.map(({ name, rows, bytes }) => ({ name, rows: rows ?? null, bytes })) }));
      view.convertible = d.convertible;
      view.gated = d.gated;
      if (d.description && !view.description) view.description = d.description;
    } else if (connectors[s.connector]) {
      const token = s.connector === "kaggle" ? await engine.credentials.reveal(req.userId, "kaggle").catch(() => null) : null;
      const d = await connectors[s.connector].describe(s.ref, { token });
      view.configs = [];
      view.convertible = d.convertible !== false;
      view.needsCredential = connectors[s.connector].needsCredential ?? null;
      view.hasCredential = view.needsCredential ? Boolean(token) : null;
      if (d.description && !view.description) view.description = d.description;
      if (d.size?.rows && !view.size?.rows) view.size = { ...view.size, rows: d.size.rows };
    }
    res.json({ source: view });
  }));

  // A source from a web link or a connector's id: it joins the catalogue
  router.post("/sources", express.json(), wrap(async (req, res) => {
    const { url, connector, ref } = req.body ?? {};
    const id = url ? "url" : String(connector ?? "");
    if (!["url", "huggingface", "openml", "uci", "kaggle"].includes(id)) throw badRequest("Give a web link, or a source and its id.", "BAD_SOURCE");
    const token = id === "kaggle" ? await engine.credentials.reveal(req.userId, "kaggle").catch(() => null) : null;
    const d = await connectors[id].describe(url ?? ref, { token });
    const now = new Date();
    const { configs: _c, convertible: _v, gated, adult, popularity, ...rest } = d;
    // Plain links stay with whoever added them; ids of the public catalogues are shared
    const owner = id === "url" ? req.userId : null;
    const doc = await col("sources").findOneAndUpdate(
      { connector: d.connector, ref: d.ref, ...(owner ? { ownerUserId: owner } : {}) },
      {
        $set: { gated: Boolean(gated), adult: Boolean(adult), checkedAt: now, popularity: popularity ?? 0 },
        $setOnInsert: { title: rest.title, description: rest.description ?? "", modalities: rest.modalities ?? [], tasks: rest.tasks ?? [], licence: rest.licence ?? "unknown", size: rest.size ?? {}, tags: rest.tags ?? [], uses: 0, addedBy: "user", ownerUserId: owner, createdAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    res.status(201).json({ source: sourceView(doc) });
  }));

  // ---------- Uploads ----------

  router.post("/uploads", express.json(), wrap(async (req, res) => {
    const name = cleanName(req.body?.name, "name");
    const now = new Date();
    const uploadId = new ObjectId();
    const { insertedId } = await col("sources").insertOne({
      connector: "upload",
      ref: String(uploadId),
      title: name,
      description: "Your own files.",
      modalities: [],
      tasks: [],
      licence: "unknown",
      size: { bytes: 0, files: 0 },
      tags: [],
      popularity: 0,
      uses: 0,
      addedBy: "user",
      ownerUserId: req.userId,
      upload: { state: "open", files: 0, bytes: 0 },
      createdAt: now,
      checkedAt: now,
    });
    res.status(201).json({ uploadId: String(uploadId), sourceId: String(insertedId) });
  }));

  router.post("/uploads/:id/files", wrap(async (req, res) => {
    const uploadId = String(oid(req.params.id, "upload"));
    const src = await col("sources").findOne({ connector: "upload", ref: uploadId, ownerUserId: req.userId });
    if (!src) throw notFound("That upload");
    if (src.upload?.state !== "open") throw conflict("That upload is already in use.", "UPLOAD_CLOSED");
    if ((src.upload?.files ?? 0) >= MAX_UPLOAD_FILES) throw badRequest(`At most ${MAX_UPLOAD_FILES} files at once.`, "TOO_MANY_FILES");
    const rel = cleanUploadPath(req.query.path);
    const { bytes: used } = await usage(req.userId);
    const room = Math.min(cfg.limits.uploadBytes, cfg.limits.diskBytes - used);
    const declared = Number(req.headers["content-length"] ?? 0);
    if (room <= 0 || declared > room) throw new DataError(413, "TOO_BIG", "There isn't enough space left for that file.");
    await storage.ensureUser(req.userId);
    const written = await storage.writeStream(req.userId, `uploads/${uploadId}/${rel}`, req, room);
    await col("sources").updateOne({ _id: src._id }, { $inc: { "upload.files": 1, "upload.bytes": written, "size.files": 1, "size.bytes": written } });
    res.status(201).json({ path: rel, bytes: written });
  }));

  // ---------- Datasets ----------

  router.get("/datasets", wrap(async (req, res) => {
    const list = await col("datasets").find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(200).toArray();
    const runIds = list.map((d) => d.lastRunId).filter(Boolean);
    const runs = new Map((await col("runs").find({ _id: { $in: runIds } }).toArray()).map((r) => [String(r._id), r]));
    const sourceIds = list.map((d) => d.sourceIds?.[0]).filter(Boolean);
    const sources = new Map((await col("sources").find({ _id: { $in: sourceIds } }).toArray()).map((s) => [String(s._id), s]));
    res.json({ datasets: list.map((d) => datasetView(d, { run: runs.get(String(d.lastRunId)), source: sources.get(String(d.sourceIds?.[0])) })) });
  }));

  router.post("/datasets", express.json(), wrap(async (req, res) => {
    const b = req.body ?? {};
    const userId = req.userId;
    const name = cleanName(b.name, "dataset name");
    const goal = String(b.goal ?? "").trim().slice(0, 500);
    const { bytes: used, runsActive } = await usage(userId);
    if (runsActive >= cfg.limits.runsAtOnce) throw new DataError(429, "TOO_MANY_RUNS", `You can build ${cfg.limits.runsAtOnce} datasets at once. Wait for one to finish.`);
    const room = cfg.limits.diskBytes - used;
    if (room <= 0) throw new DataError(413, "NO_SPACE", "Your data space is full. Remove a dataset to make room.");

    let source;
    let uploadId = null;
    let plan = null;
    if (b.uploadId) {
      uploadId = String(oid(b.uploadId, "upload"));
      source = await col("sources").findOne({ connector: "upload", ref: uploadId, ownerUserId: userId });
      if (!source) throw notFound("That upload");
      if (source.upload?.state !== "open") throw conflict("Those files have already been made into a dataset. Upload them again to make another.", "UPLOAD_USED");
      if (!source.upload?.files) throw badRequest("That upload has no files yet.", "UPLOAD_EMPTY");
    } else {
      source = await col("sources").findOne({ _id: oid(b.sourceId, "source"), $or: [{ ownerUserId: null }, { ownerUserId: userId }] });
      if (!source) throw notFound("That source");
      const connector = connectors[source.connector];
      if (!connector || source.connector === "upload") throw badRequest("Datasets from this kind of source arrive in a later update.", "CONNECTOR_NOT_READY");
      if (connector.needsCredential && !(await engine.credentials.list(userId)).find((c) => c.kind === connector.needsCredential)?.saved)
        throw new DataError(403, "NEEDS_TOKEN", `This source needs your ${connector.needsCredential === "kaggle" ? "Kaggle" : connector.needsCredential} token. Add it in Data settings first.`);
      plan = source.connector === "huggingface" ? await connector.fetchPlan(source.ref, { config: b.config, split: b.split }) : await connector.fetchPlan(source.ref);
      if (plan.bytes > room) throw new DataError(413, "NO_SPACE", "This dataset is bigger than the space you have left.");
    }

    const options = b.options ?? {};
    const now = new Date();
    const datasetId = new ObjectId();
    const runId = new ObjectId();
    const versionId = new ObjectId();
    try {
      await col("datasets").insertOne({
        _id: datasetId,
        userId,
        name,
        goal,
        modality: options.modality ?? null,
        task: options.task ?? null,
        projectId: b.projectId ? oid(b.projectId, "project") : null,
        state: "building",
        rows: null,
        versionCount: 0,
        headVersionId: null,
        publishedVersionId: null,
        sourceIds: [source._id],
        lastRunId: runId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      if (e?.code === 11000) throw conflict(`You already have a dataset called "${name}".`, "NAME_TAKEN");
      throw e;
    }
    if (uploadId) await col("sources").updateOne({ _id: source._id }, { $set: { "upload.state": "used" } });

    const steps = buildSteps({ runId, datasetId, versionId, source, plan, uploadId, options, maxBytes: room });
    const run = await createRun(db(), { runId, userId, datasetId, kind: "build", steps, cleanup: [uploadId ? `uploads/${uploadId}` : `raw/${runId}`] }, now);
    await addEvent(db(), run, { kind: "state", message: "Waiting to start.", data: { run: "queued" } });
    await enqueue(db(), { type: "run.advance", userId, runId, maxAttempts: 8 }, now);
    await col("audit_events").insertOne({ userId, at: now, action: "dataset.create", target: datasetId, details: { sourceId: source._id, plan: plan ? { config: plan.config, splits: plan.splits, bytes: plan.bytes } : null } });

    const dataset = await col("datasets").findOne({ _id: datasetId });
    res.status(201).json({ dataset: datasetView(dataset, { source, run }) });
  }));

  router.get("/datasets/:id", wrap(async (req, res) => {
    const d = await mine("datasets", req.params.id, req.userId, "That dataset");
    const [run, source] = await Promise.all([d.lastRunId ? col("runs").findOne({ _id: d.lastRunId }) : null, col("sources").findOne({ _id: d.sourceIds?.[0] })]);
    res.json({ dataset: datasetView(d, { run, source }) });
  }));

  router.patch("/datasets/:id", express.json(), wrap(async (req, res) => {
    const d = await mine("datasets", req.params.id, req.userId, "That dataset");
    const set = { updatedAt: new Date() };
    if (req.body?.name !== undefined) set.name = cleanName(req.body.name, "dataset name");
    if (req.body?.goal !== undefined) set.goal = String(req.body.goal).trim().slice(0, 500);
    try {
      await col("datasets").updateOne({ _id: d._id }, { $set: set });
    } catch (e) {
      if (e?.code === 11000) throw conflict(`You already have a dataset called "${set.name}".`, "NAME_TAKEN");
      throw e;
    }
    res.json({ dataset: datasetView(await col("datasets").findOne({ _id: d._id })) });
  }));

  router.delete("/datasets/:id", wrap(async (req, res) => {
    const d = await mine("datasets", req.params.id, req.userId, "That dataset");
    if (await col("runs").countDocuments({ datasetId: d._id, state: { $nin: FINAL } })) throw conflict("This dataset is still being built. Cancel the build first.", "RUN_ACTIVE");
    if (d.projectId && d.publishedVersionId) throw conflict("A project uses this dataset's published version.", "IN_USE");
    await storage.remove(req.userId, `datasets/${d._id}`);
    await Promise.all([
      col("versions").deleteMany({ datasetId: d._id }),
      col("runs").deleteMany({ datasetId: d._id }),
      col("run_events").deleteMany({ datasetId: d._id }),
      col("review_items").deleteMany({ datasetId: d._id }),
    ]);
    await col("datasets").deleteOne({ _id: d._id });
    await col("audit_events").insertOne({ userId: req.userId, at: new Date(), action: "dataset.delete", target: d._id, details: { name: d.name } });
    res.status(204).end();
  }));

  router.get("/datasets/:id/versions", wrap(async (req, res) => {
    const d = await mine("datasets", req.params.id, req.userId, "That dataset");
    const list = await col("versions").find({ datasetId: d._id, userId: req.userId }).sort({ number: -1 }).toArray();
    res.json({ versions: list.map(versionView) });
  }));

  // ---------- Versions ----------

  router.get("/versions/:id", wrap(async (req, res) => {
    res.json({ version: versionView(await mine("versions", req.params.id, req.userId, "That version")) });
  }));

  router.get("/versions/:id/rows", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)));
    const split = req.query.split ? String(req.query.split).slice(0, 40) : null;
    const manifest = await storage.readJson(req.userId, `${v.path}/manifest.json`);
    if (!manifest) throw notFound("This version's files");
    res.json(await readRows(storage.resolve(req.userId, v.path), manifest, offset, limit, { split }));
  }));

  router.get("/versions/:id/profile", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    const profile = await storage.readJson(req.userId, `${v.path}/profile.json`);
    if (!profile) throw notFound("This version's profile");
    res.json({ profile });
  }));

  // ---------- Recipes ----------

  router.get("/recipes/catalog", (req, res) => res.json({ steps: STEP_CATALOG, exportFormats: EXPORT_FORMATS }));
  router.get("/recipes/templates", (req, res) => res.json({ templates: TEMPLATES }));

  const recipeView = (r) => ({ id: String(r._id), name: r.name, description: r.description ?? "", modality: r.modality ?? null, steps: r.steps, origin: r.origin, updatedAt: r.updatedAt });

  router.get("/recipes", wrap(async (req, res) => {
    const list = await col("recipes").find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(100).toArray();
    res.json({ recipes: list.map(recipeView) });
  }));

  router.post("/recipes", express.json(), wrap(async (req, res) => {
    const now = new Date();
    const modality = ["text", "tabular"].includes(req.body?.modality) ? req.body.modality : null;
    const doc = { userId: req.userId, name: cleanName(req.body?.name, "recipe name"), description: String(req.body?.description ?? "").slice(0, 300), modality, steps: normaliseSteps(req.body?.steps, modality), origin: "user", createdAt: now, updatedAt: now };
    const { insertedId } = await col("recipes").insertOne(doc);
    res.status(201).json({ recipe: recipeView({ ...doc, _id: insertedId }) });
  }));

  router.patch("/recipes/:id", express.json(), wrap(async (req, res) => {
    const r = await mine("recipes", req.params.id, req.userId, "That recipe");
    const set = { name: cleanName(req.body?.name ?? r.name, "recipe name"), steps: normaliseSteps(req.body?.steps ?? r.steps, r.modality), updatedAt: new Date() };
    await col("recipes").updateOne({ _id: r._id }, { $set: set });
    res.json({ recipe: recipeView({ ...r, ...set }) });
  }));

  router.delete("/recipes/:id", wrap(async (req, res) => {
    const r = await mine("recipes", req.params.id, req.userId, "That recipe");
    await col("recipes").deleteOne({ _id: r._id });
    res.status(204).end();
  }));

  router.get("/datasets/:id/suggested-recipe", wrap(async (req, res) => {
    const d = await mine("datasets", req.params.id, req.userId, "That dataset");
    const v = d.headVersionId ? await col("versions").findOne({ _id: d.headVersionId }) : null;
    if (!v) throw conflict("This dataset has no version yet.", "NO_VERSION");
    const profile = await storage.readJson(req.userId, `${v.path}/profile.json`);
    res.json({ steps: suggestSteps(profile, v.modality, v.splits), basedOn: String(v._id) });
  }));

  // ---------- Quality, changes, publish, exports ----------

  router.get("/versions/:id/changes", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    res.json({ changes: (await storage.readJson(req.userId, `${v.path}/changes.json`)) ?? null });
  }));

  router.get("/versions/:id/quality", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    res.json({ quality: (await storage.readJson(req.userId, `${v.path}/quality.json`)) ?? null });
  }));

  router.post("/versions/:id/publish", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    const now = new Date();
    await col("versions").updateOne({ _id: v._id }, { $set: { frozen: true, publishedAt: now } });
    await col("datasets").updateOne({ _id: v.datasetId }, { $set: { publishedVersionId: v._id, updatedAt: now } });
    await col("audit_events").insertOne({ userId: req.userId, at: now, action: "version.publish", target: v._id, details: { number: v.number } });
    res.json({ version: versionView({ ...v, frozen: true }) });
  }));

  /** What the download's README tells: name, goal, sources and licences, how each version was made, quality. */
  async function cardInfo(dataset, version) {
    const chain = [];
    for (let v = version; v && chain.length < 50; v = v.parentVersionId ? await col("versions").findOne({ _id: v.parentVersionId }) : null) chain.unshift(v);
    const sources = await col("sources").find({ _id: { $in: dataset.sourceIds ?? [] } }).toArray();
    return {
      name: dataset.name,
      goal: dataset.goal || null,
      sources: sources.map((s) => ({ title: s.title, ref: s.connector === "upload" ? null : s.ref, licence: licenceInfo(s.licence) })),
      history: chain.map((v) => ({ number: v.number, op: v.madeBy?.op, label: STEP_LABELS[v.madeBy?.op] ?? v.madeBy?.op, notes: (v.changes?.notes ?? []).slice(0, 4) })),
      quality: version.quality ? { score: version.quality.score, verdict: version.quality.verdict, gates: (version.quality.gates ?? []).map(({ title, passed, reason }) => ({ title, passed, reason })) } : null,
    };
  }

  async function startRun(userId, dataset, input, kind, steps, recipeName = null) {
    const { runsActive } = await usage(userId);
    if (runsActive >= cfg.limits.runsAtOnce) throw new DataError(429, "TOO_MANY_RUNS", `You can run ${cfg.limits.runsAtOnce} things at once. Wait for one to finish.`);
    const now = new Date();
    const run = await createRun(db(), { userId, datasetId: dataset._id, inputVersionId: input._id, kind, steps, recipeName }, now);
    await col("datasets").updateOne({ _id: dataset._id }, { $set: { state: kind === "pipeline" ? "building" : dataset.state, lastRunId: kind === "pipeline" ? run._id : dataset.lastRunId, updatedAt: now } });
    await addEvent(db(), run, { kind: "state", message: "Waiting to start.", data: { run: "queued" } });
    await enqueue(db(), { type: "run.advance", userId, runId: run._id, maxAttempts: 8 }, now);
    return run;
  }

  router.post("/versions/:id/exports", express.json(), wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    const format = String(req.body?.format ?? "parquet");
    if (!EXPORT_FORMATS.includes(format)) throw badRequest(`Choose one of ${EXPORT_FORMATS.join(", ")}.`, "BAD_FORMAT");
    const dataset = await col("datasets").findOne({ _id: v.datasetId });
    const run = await startRun(req.userId, dataset, v, "export", exportSteps({ version: v, format, card: await cardInfo(dataset, v) }));
    res.status(202).json({ run: runView(run) });
  }));

  router.get("/versions/:id/exports/:format/download", wrap(async (req, res) => {
    const v = await mine("versions", req.params.id, req.userId, "That version");
    const e = v.exports?.[req.params.format];
    if (!e || !EXPORT_FORMATS.includes(req.params.format)) throw notFound("That download");
    const full = storage.resolve(req.userId, e.path);
    const info = await stat(full).catch(() => null);
    if (!info) throw notFound("That download");
    const dataset = await col("datasets").findOne({ _id: v.datasetId }, { projection: { name: 1 } });
    const base = `${(dataset?.name ?? "dataset").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "dataset"}-v${v.number}-${req.params.format}.zip`;
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": info.size, "Content-Disposition": `attachment; filename="${base}"`, "Cache-Control": "no-store" });
    createReadStream(full).pipe(res);
  }));

  // ---------- Runs ----------

  router.post("/runs", express.json(), wrap(async (req, res) => {
    const dataset = await mine("datasets", req.body?.datasetId, req.userId, "That dataset");
    const input = req.body?.inputVersionId ? await mine("versions", req.body.inputVersionId, req.userId, "That version") : dataset.headVersionId ? await col("versions").findOne({ _id: dataset.headVersionId }) : null;
    if (!input || String(input.datasetId) !== String(dataset._id)) throw conflict("This dataset has no version to work on yet.", "NO_VERSION");
    let raw = req.body?.steps;
    let recipeName = null;
    if (req.body?.recipeId) {
      const recipe = await mine("recipes", req.body.recipeId, req.userId, "That recipe");
      raw = recipe.steps;
      recipeName = recipe.name;
    } else if (req.body?.templateId) {
      const t = TEMPLATES.find((x) => x.id === req.body.templateId);
      if (!t) throw notFound("That template");
      raw = t.steps;
      recipeName = t.name;
    }
    const steps = normaliseSteps(raw, input.modality);
    const run = await startRun(req.userId, dataset, input, "pipeline", pipelineSteps({ datasetId: dataset._id, input, steps, ObjectIdCtor: ObjectId }), recipeName);
    res.status(201).json({ run: runView(run) });
  }));


  router.get("/runs", wrap(async (req, res) => {
    const filter = { userId: req.userId };
    if (req.query.datasetId) filter.datasetId = oid(req.query.datasetId, "dataset");
    const list = await col("runs").find(filter).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ runs: list.map(runView) });
  }));

  router.get("/runs/:id", wrap(async (req, res) => {
    res.json({ run: runView(await mine("runs", req.params.id, req.userId, "That run")) });
  }));

  router.post("/runs/:id/cancel", wrap(async (req, res) => {
    const run = await mine("runs", req.params.id, req.userId, "That run");
    if (FINAL.includes(run.state)) throw conflict("This run has already ended.", "RUN_ENDED");
    await col("runs").updateOne({ _id: run._id }, { $set: { cancelRequested: true } });
    res.json({ run: runView({ ...run, cancelRequested: true }) });
  }));

  router.post("/runs/:id/retry", wrap(async (req, res) => {
    let run = await mine("runs", req.params.id, req.userId, "That run");
    if (run.state !== "failed") throw conflict("Only a run that stopped with a problem can be tried again.", "NOT_FAILED");
    const i = run.currentStep;
    run = await updateRun(db(), run, { state: "queued", error: null, endedAt: null, cancelRequested: false, [`steps.${i}.state`]: "pending", [`steps.${i}.error`]: null });
    await col("datasets").updateOne({ _id: run.datasetId }, { $set: { state: "building", lastRunId: run._id, updatedAt: new Date() } });
    await addEvent(db(), run, { kind: "state", message: "Trying again from the step that stopped.", data: { run: "queued" } });
    await enqueue(db(), { type: "run.advance", userId: req.userId, runId: run._id, maxAttempts: 8 });
    res.json({ run: runView(run) });
  }));

  router.get("/runs/:id/events", wrap(async (req, res) => {
    const run = await mine("runs", req.params.id, req.userId, "That run");
    const afterSeq = Math.max(0, Number(req.query.afterSeq) || 0);
    const list = await col("run_events").find({ runId: run._id, seq: { $gt: afterSeq } }).sort({ seq: 1 }).limit(500).toArray();
    res.json({ events: list.map(eventView) });
  }));

  router.get("/events", (req, res) => engine.live.handler(req, res));

  // Errors in the shape continuum-api uses ({ error, code })
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof DataError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.code === "TOO_BIG") return res.status(413).json({ error: err.message, code: "TOO_BIG" });
    engine.log.error({ err }, "data route failed");
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our side.", code: "INTERNAL_ERROR" });
  });

  return router;
}
