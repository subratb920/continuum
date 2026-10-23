// src/brain/routes.js
//
// The Agents screen's brain (signed-in users), relayed to continuum-brain's
// brain-api for the signed-in user, in the screen's shapes (_id):
//   GET    /brain/agents                    your brain and your workers
//   GET    /brain/stream?after=&token=      live: "agent", "event" and "answered" messages (server-
//                                           sent events; after= an event's seq; EventSource can't send
//                                           headers, so this route also takes the sign-in token as ?token=)
//   GET    /brain/pending                   what waits on you: requests not yet answered, oldest first
//   POST   /brain/agents {task, projectId? | goal?: {bridgeId, goalId} | repo?}  (on your one model)
//                                           a worker: on that project, interval goal or repository;
//                                           with none of them, your brain picks the project
//   POST   /brain/agents/:id/stop   DELETE /brain/agents/:id
//   GET    /brain/agents/:id/changes        what a worker changed on its branch (with diffs)
//   GET    /brain/agents/:id/file?path=     one file of its working copy (written into your own folder)
//   POST   /brain/agents/:id/push {message?} its changes to its own branch on GitHub (never main)
//   POST   /brain/agents/:id/reply {eventId, answer, message?}
//                                           a permission (approve | always | deny, with a note) or a question;
//                                           answered already: 200 with alreadyAnswered
//   POST   /brain/core/messages {text}      a message to your brain
//   POST   /brain/core/agent-interval {bridgeId}  an agent interval started: your brain works its goals
//   POST   /brain/projects/:id/snapshot     your project folder (.tar.gz, from your computer): workers of
//                                           an interval that works in your folder start from it
//   GET    /brain/models   GET|PUT /brain/settings {model?, mode?}   the one model all your agents run on, and its speed
//   GET    /brain/compute-catalog           the live GCP machine catalog (machine shapes, GPUs, quota) for the compute picker
//   GET|POST /brain/workflows[?bridgeId=]   GET|PUT|DELETE /brain/workflows/:id   POST …/{use|approve|cancel|template}   POST …/steps/:stepId/{approve|send-back}
//   GET|POST /brain/skills   PUT|DELETE /brain/skills/:id   your own skills
//   GET    /brain/reviews?bridgeId=   POST /brain/reviews/:id/{approvals|decisions|changes|applied}   the final review (works in your folder)

import express from "express";
import { AppError } from "../errors/AppError.js";
import { brainClient, BrainUnavailableError } from "./client.js";

const ID = /^[a-f0-9]{24}$/;
/** Where a stream resumes: an event's seq (or, from before seq, its id). */
const CURSOR = /^(\d{1,15}|[a-f0-9]{24})$/;

/** brain-api's id → the screen's _id. */
export const toAgent = (a) => ({ ...a, _id: a.id });

/** "+12 −3" from a unified diff (the card shows the size of a change, not the whole diff). */
export function diffSize(diff) {
  if (typeof diff !== "string" || !/^(---|\+\+\+|@@)/m.test(diff)) return null;
  let add = 0;
  let del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return `+${add} −${del}`;
}

/** An event in the screen's shape: _id; a question's choices as options; a permission's target and change size. */
export function toEvent(e) {
  const data = { ...(e.data ?? {}) };
  if (e.kind === "question" && Array.isArray(data.questions) && data.questions[0]) data.options = data.questions[0].options;
  if (e.kind === "permission") {
    const colon = e.text.indexOf(": ");
    if (colon > 0) data.target = e.text.slice(colon + 2);
    const size = diffSize(data.detail);
    if (size) data.diff = size;
  }
  return { ...e, _id: e.id, ...(Object.keys(data).length ? { data } : {}) };
}

/** The sign-in token as ?token= for the stream only (before requireAuth; EventSource can't send headers). */
export function streamToken(req, _res, next) {
  if (req.path === "/stream" && !req.headers.authorization && typeof req.query.token === "string" && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

const PERMISSION_REPLY = { approve: "once", once: "once", always: "always", deny: "reject", reject: "reject" };

export function createBrainRouter(opts = {}) {
  const router = express.Router();
  let client = opts.client ?? null;

  router.use((_req, _res, next) => {
    client ??= process.env.BRAIN_URL && process.env.BRAIN_INTERNAL_TOKEN ? brainClient(process.env.BRAIN_URL, process.env.BRAIN_INTERNAL_TOKEN) : null;
    if (!client) return next(new AppError("The brain isn't set up here.", 503, "BRAIN_UNAVAILABLE"));
    next();
  });

  // Who the relayed call acts as: the signed-in user, and the tenant (Space) they're working in (personal unless an org space is active).
  const caller = (req) => ({ userId: String(req.user.id), spaceId: req.space?.id ?? `u:${req.user.id}` });
  /** One call; brain-api's refusals pass on as they are (status, code, message). */
  async function brain(req, method, path, body) {
    let r;
    try {
      r = await client.call(caller(req), method, path, body);
    } catch (e) {
      if (e instanceof BrainUnavailableError) throw new AppError(e.message, 503, "BRAIN_UNAVAILABLE");
      throw e;
    }
    if (r.status >= 400) throw new AppError(r.data?.error?.message ?? "The brain couldn't do that.", r.status, r.data?.error?.code ?? "BRAIN_ERROR");
    return r.data;
  }
  const agentId = (req) => {
    if (!ID.test(req.params.id)) throw new AppError("No such agent.", 404, "NOT_FOUND");
    return req.params.id;
  };

  router.get("/agents", async (req, res) => {
    const [workers, thread] = await Promise.all([brain(req, "GET", "/agents"), brain(req, "GET", "/brain")]);
    res.set("Cache-Control", "no-store").json([...(thread.brain ? [thread.brain] : []), ...workers].map(toAgent));
  });

  router.get("/stream", async (req, res) => {
    const after = typeof req.query.after === "string" && CURSOR.test(req.query.after) ? req.query.after : (req.get("last-event-id") ?? "");
    const ctl = new AbortController();
    req.on("close", () => ctl.abort());
    let upstream;
    try {
      upstream = await client.stream(caller(req), CURSOR.test(after) ? { after } : { history: "1" }, ctl.signal);
    } catch (e) {
      if (e instanceof BrainUnavailableError) throw new AppError(e.message, 503, "BRAIN_UNAVAILABLE");
      throw e;
    }
    if (!upstream.ok || !upstream.body) throw new AppError("The brain's live view isn't available right now.", 503, "BRAIN_UNAVAILABLE");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    // Each block passes through, its data in the screen's shape
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of upstream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!name || !data) {
            res.write(`${block}\n\n`); // retry: and keep-alive comments
            continue;
          }
          let v;
          try {
            v = JSON.parse(data);
          } catch {
            continue;
          }
          const id = /^id: (.+)$/m.exec(block)?.[1];
          const out = name === "agent" ? toAgent(v) : name === "event" || name === "answered" ? toEvent(v) : v;
          res.write(`${id ? `id: ${id}\n` : ""}event: ${name}\ndata: ${JSON.stringify(out)}\n\n`);
        }
      }
    } catch {
      // the page went away, or brain-api restarted: the page reconnects by itself
    }
    res.end();
  });

  router.get("/pending", async (req, res) => {
    res.set("Cache-Control", "no-store").json((await brain(req, "GET", "/pending")).map(toEvent));
  });

  router.post("/agents", async (req, res) => {
    const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
    if (!task && !req.body?.goal) throw new AppError("Say what the worker should do.", 400, "VALIDATION_ERROR");
    const { projectId, repo, goal } = req.body ?? {};
    // A retried or double-clicked spawn with the same key makes one worker, not two
    const idempotencyKey = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey ? req.body.idempotencyKey.slice(0, 200) : undefined;
    // Started directly: on a project, an interval goal (its project, from Continuum) or a repository (a retry)
    if (projectId || goal || repo) {
      const where = goal ? { goal: { bridgeId: goal.bridgeId, goalId: goal.goalId } } : projectId ? { projectId } : { repo };
      // No model: your brain and every worker run on one model (Models, /brain/settings)
      return res.status(201).json(toAgent(await brain(req, "POST", "/agents", { ...where, task, ...(idempotencyKey ? { idempotencyKey } : {}) })));
    }
    // Nothing given: your brain picks the project (and asks you when it isn't clear)
    const text = `Start a worker agent for this task. Pick the right project with your tools; if it isn't clear which one, ask me first.\n\nTask: ${task}`;
    res.status(202).json(toAgent(await brain(req, "POST", "/brain/messages", { text })));
  });

  router.post("/agents/:id/stop", async (req, res) => {
    res.json(toAgent(await brain(req, "POST", `/agents/${agentId(req)}/stop`)));
  });

  router.get("/agents/:id/changes", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/agents/${agentId(req)}/changes`));
  });

  router.get("/agents/:id/file", async (req, res) => {
    const path = typeof req.query.path === "string" ? req.query.path : "";
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/agents/${agentId(req)}/file?path=${encodeURIComponent(path)}`));
  });

  router.post("/agents/:id/push", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message : undefined;
    res.json(await brain(req, "POST", `/agents/${agentId(req)}/push`, message ? { message } : {}));
  });

  router.delete("/agents/:id", async (req, res) => {
    await brain(req, "DELETE", `/agents/${agentId(req)}`);
    res.status(202).json({ removing: true });
  });

  router.post("/agents/:id/reply", async (req, res) => {
    const id = agentId(req);
    const { eventId, answer } = req.body ?? {};
    if (typeof eventId !== "string" || !ID.test(eventId)) throw new AppError("Which request are you answering?", 400, "VALIDATION_ERROR");
    // What still waits first (however long ago it was asked), else the agent's events (answered already?)
    const waiting = await brain(req, "GET", "/pending");
    const asked = waiting.find((e) => e.id === eventId && e.agentId === id) ?? (await brain(req, "GET", `/agents/${id}/events`)).find((e) => e.id === eventId);
    if (!asked || !asked.data?.id) throw new AppError("That request isn't waiting any more.", 404, "NOT_FOUND");
    if (asked.answeredAt) return res.json({ ...toAgent(await brain(req, "GET", `/agents/${id}`)), alreadyAnswered: true });
    if (asked.kind === "permission") {
      const reply = PERMISSION_REPLY[answer];
      if (!reply) throw new AppError("Answer approve, always or deny.", 400, "VALIDATION_ERROR");
      // A denial can say why, or what to do instead (the agent reads it)
      const message = reply === "reject" && typeof req.body.message === "string" && req.body.message.trim() ? req.body.message.trim().slice(0, 2000) : null;
      return res.json(toAgent(await brain(req, "POST", `/agents/${id}/permissions/${asked.data.id}`, { reply, ...(message ? { message } : {}) })));
    }
    if (asked.kind === "question") {
      if (answer !== null && (typeof answer !== "string" || !answer.trim())) throw new AppError("Give an answer.", 400, "VALIDATION_ERROR");
      const count = Array.isArray(asked.data.questions) ? Math.max(1, asked.data.questions.length) : 1;
      const answers = answer === null ? null : Array.from({ length: count }, () => [answer.trim()]);
      return res.json(toAgent(await brain(req, "POST", `/agents/${id}/questions/${asked.data.id}`, { answers })));
    }
    throw new AppError("That isn't a request you can answer.", 400, "VALIDATION_ERROR");
  });

  router.post("/core/messages", async (req, res) => {
    res.status(202).json(toAgent(await brain(req, "POST", "/brain/messages", { text: req.body?.text })));
  });

  // Stop what the brain is doing now but keep it warm (ready for a new message)
  router.post("/interrupt", async (req, res) => {
    const core = await brain(req, "POST", "/brain/interrupt");
    res.json(core ? toAgent(core) : null);
  });

  const SNAPSHOT_MAX = 60 * 1024 * 1024;
  router.post("/projects/:id/snapshot", async (req, res) => {
    const projectId = String(req.params.id);
    if (!ID.test(projectId)) throw new AppError("No such project.", 404, "NOT_FOUND");
    // Stream the upload straight through to the brain (never buffer the whole .tar.gz); guard the size by its declared length
    const len = Number(req.headers["content-length"]);
    if (Number.isFinite(len) && len > SNAPSHOT_MAX) throw new AppError("That folder is too big (over 60 MB).", 413, "TOO_LARGE");
    if (len === 0) throw new AppError("Send the folder as a .tar.gz.", 400, "VALIDATION_ERROR");
    const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "application/gzip";
    let r;
    try {
      r = await client.send(caller(req), `/projects/${projectId}/snapshots`, req, contentType);
    } catch (e) {
      if (e instanceof BrainUnavailableError) throw new AppError(e.message, 503, "BRAIN_UNAVAILABLE");
      throw e;
    }
    if (r.status >= 400) throw new AppError(r.data?.error?.message ?? "The brain couldn't take the folder.", r.status, r.data?.error?.code ?? "BRAIN_ERROR");
    res.status(201).json(r.data);
  });

  router.post("/core/agent-interval", async (req, res) => {
    const bridgeId = String(req.body?.bridgeId ?? "");
    if (!ID.test(bridgeId)) throw new AppError("bridgeId must be a bridge ID.", 400, "VALIDATION_ERROR");
    res.status(202).json(toAgent(await brain(req, "POST", "/brain/agent-interval", { bridgeId })));
  });

  // Workflows: your templates, and each agent interval's run (the brain drafts it, you edit and approve it)
  const workflowId = (req) => {
    const id = String(req.params.id);
    if (!ID.test(id)) throw new AppError("No such workflow.", 404, "NOT_FOUND");
    return id;
  };
  const workflowBody = (b) => ({ name: b?.name, description: b?.description, steps: b?.steps, edges: b?.edges, version: b?.version });
  router.get("/workflows", async (req, res) => {
    const bridgeId = typeof req.query.bridgeId === "string" ? req.query.bridgeId : null;
    if (bridgeId !== null && !ID.test(bridgeId)) throw new AppError("bridgeId must be a bridge ID.", 400, "VALIDATION_ERROR");
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/workflows${bridgeId ? `?bridgeId=${bridgeId}` : ""}`));
  });
  router.post("/workflows", async (req, res) => res.status(201).json(await brain(req, "POST", "/workflows", workflowBody(req.body))));
  router.get("/workflows/:id", async (req, res) => res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/workflows/${workflowId(req)}`)));
  router.put("/workflows/:id", async (req, res) => res.json(await brain(req, "PUT", `/workflows/${workflowId(req)}`, workflowBody(req.body))));
  router.delete("/workflows/:id", async (req, res) => {
    await brain(req, "DELETE", `/workflows/${workflowId(req)}`);
    res.status(204).end();
  });
  router.post("/workflows/:id/use", async (req, res) => res.status(201).json(await brain(req, "POST", `/workflows/${workflowId(req)}/use`, { bridgeId: req.body?.bridgeId })));
  for (const action of ["approve", "cancel"]) {
    router.post(`/workflows/:id/${action}`, async (req, res) => res.json(await brain(req, "POST", `/workflows/${workflowId(req)}/${action}`, {})));
  }
  router.post("/workflows/:id/template", async (req, res) => res.status(201).json(await brain(req, "POST", `/workflows/${workflowId(req)}/template`, { name: req.body?.name })));
  // An approval gate: pass it, or send it back (along its loop arrow, with what to change)
  for (const action of ["approve", "send-back"]) {
    router.post(`/workflows/:id/steps/:stepId/${action}`, async (req, res) => {
      const stepId = String(req.params.stepId);
      if (!/^[\w.-]{1,40}$/.test(stepId)) throw new AppError("No such step.", 404, "NOT_FOUND");
      res.json(await brain(req, "POST", `/workflows/${workflowId(req)}/steps/${stepId}/${action}`, action === "send-back" ? { note: typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : "" } : {}));
    });
  }

  // Your own skills (know-how your agents load when it fits): list, add, change, delete
  const skillId = (req) => {
    const id = String(req.params.id);
    if (!ID.test(id)) throw new AppError("No such skill.", 404, "NOT_FOUND");
    return id;
  };
  const skillBody = (b) => ({ name: b?.name, description: b?.description, body: b?.body, for: b?.for, projects: b?.projects });
  router.get("/skills", async (req, res) => res.set("Cache-Control", "no-store").json(await brain(req, "GET", "/skills")));
  router.post("/skills", async (req, res) => res.status(201).json(await brain(req, "POST", "/skills", skillBody(req.body))));
  router.put("/skills/:id", async (req, res) => res.json(await brain(req, "PUT", `/skills/${skillId(req)}`, skillBody(req.body))));
  router.delete("/skills/:id", async (req, res) => {
    await brain(req, "DELETE", `/skills/${skillId(req)}`);
    res.status(204).end();
  });

  // The final review of an agent interval that works in your folder: approve, choose per clash, send a worker back, applied
  const reviewId = (req) => {
    const id = String(req.params.id);
    if (!ID.test(id)) throw new AppError("No such review.", 404, "NOT_FOUND");
    return id;
  };
  router.get("/reviews", async (req, res) => {
    const bridgeId = String(req.query.bridgeId ?? "");
    if (!ID.test(bridgeId)) throw new AppError("bridgeId must be a bridge ID.", 400, "VALIDATION_ERROR");
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/reviews?bridgeId=${bridgeId}`));
  });
  router.post("/reviews/:id/approvals", async (req, res) => res.json(await brain(req, "POST", `/reviews/${reviewId(req)}/approvals`, {})));
  router.post("/reviews/:id/decisions", async (req, res) => res.json(await brain(req, "POST", `/reviews/${reviewId(req)}/decisions`, { decisions: req.body?.decisions })));
  router.post("/reviews/:id/changes", async (req, res) => res.json(await brain(req, "POST", `/reviews/${reviewId(req)}/changes`, { agentId: req.body?.agentId, note: req.body?.note })));
  router.post("/reviews/:id/applied", async (req, res) => res.json(await brain(req, "POST", `/reviews/${reviewId(req)}/applied`, { kept: req.body?.kept })));

  router.get("/models", async (req, res) => res.json(await brain(req, "GET", "/models")));
  // The live GCP machine catalog for the compute picker (cluster-wide; { available:false } off Google Cloud).
  router.get("/compute-catalog", async (req, res) => res.set("Cache-Control", "no-store").json(await brain(req, "GET", "/compute-catalog")));
  // Observability: the user's agent activity over a period (counts, outcomes, cost, latency)
  router.get("/stats", async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ["from", "to"]) if (typeof req.query[k] === "string") qs.set(k, req.query[k]);
    const q = qs.toString();
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/stats${q ? `?${q}` : ""}`));
  });
  // The user's audit trail (consequential actions)
  router.get("/audit", async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ["from", "to", "action", "limit"]) if (typeof req.query[k] === "string") qs.set(k, req.query[k]);
    const q = qs.toString();
    res.set("Cache-Control", "no-store").json(await brain(req, "GET", `/audit${q ? `?${q}` : ""}`));
  });
  // In an org space the settings are shared workspace config, so only its owners and admins may change them.
  // (A personal space is always managed by its owner.) Mirrors managesOrg() in spaces/projectAccess.js.
  const canManageSpace = (req) => req.space?.kind !== "org" || req.space.orgRole === "owner" || req.space.orgRole === "admin";
  router.get("/settings", async (req, res) => {
    const data = await brain(req, "GET", "/settings");
    // Tell the page whose space this is and whether it may edit (so it can show the controls read-only to members/viewers)
    res.json({ ...data, space: { kind: req.space?.kind ?? "user", orgRole: req.space?.orgRole ?? null, canManage: canManageSpace(req) } });
  });
  router.put("/settings", async (req, res) => {
    if (!canManageSpace(req)) throw new AppError("Only the organization's owners and admins can change its workspace settings.", 403, "NOT_ORG_ADMIN");
    res.json(await brain(req, "PUT", "/settings", req.body ?? {}));
  });

  return router;
}
