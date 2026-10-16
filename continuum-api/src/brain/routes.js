// src/brain/routes.js
//
// The Agents screen's brain (signed-in users), relayed to continuum-brain's
// brain-api for the signed-in user, in the screen's shapes (_id):
//   GET    /brain/agents                    your brain and your workers
//   GET    /brain/stream?after=&token=      live: "agent" and "event" messages (server-sent
//                                           events; EventSource can't send headers, so this
//                                           route also takes the sign-in token as ?token=)
//   POST   /brain/agents {task, projectId? | goal?: {bridgeId, goalId} | repo?}
//                                           a worker: on that project, interval goal or repository;
//                                           with none of them, your brain picks the project
//   POST   /brain/agents/:id/stop   DELETE /brain/agents/:id
//   POST   /brain/agents/:id/reply {eventId, answer}
//                                           a permission (approve | always | deny) or a question
//   POST   /brain/core/messages {text}      a message to your brain
//   GET    /brain/models   GET|PUT /brain/settings

import express from "express";
import { AppError } from "../errors/AppError.js";
import { brainClient, BrainUnavailableError } from "./client.js";

const ID = /^[a-f0-9]{24}$/;

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

  const uid = (req) => String(req.user.id);
  /** One call; brain-api's refusals pass on as they are (status, code, message). */
  async function brain(req, method, path, body) {
    let r;
    try {
      r = await client.call(uid(req), method, path, body);
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
    const after = typeof req.query.after === "string" && ID.test(req.query.after) ? req.query.after : (req.get("last-event-id") ?? "");
    const ctl = new AbortController();
    req.on("close", () => ctl.abort());
    let upstream;
    try {
      upstream = await client.stream(uid(req), ID.test(after) ? { after } : { history: "1" }, ctl.signal);
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
          const out = name === "agent" ? toAgent(v) : name === "event" ? toEvent(v) : v;
          res.write(`${id ? `id: ${id}\n` : ""}event: ${name}\ndata: ${JSON.stringify(out)}\n\n`);
        }
      }
    } catch {
      // the page went away, or brain-api restarted: the page reconnects by itself
    }
    res.end();
  });

  router.post("/agents", async (req, res) => {
    const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
    if (!task && !req.body?.goal) throw new AppError("Say what the worker should do.", 400, "VALIDATION_ERROR");
    const { projectId, repo, goal, model } = req.body ?? {};
    // Started directly: on a project, an interval goal (its project, from Continuum) or a repository (a retry)
    if (projectId || goal || repo) {
      const where = goal ? { goal: { bridgeId: goal.bridgeId, goalId: goal.goalId } } : projectId ? { projectId } : { repo };
      return res.status(201).json(toAgent(await brain(req, "POST", "/agents", { ...where, task, ...(model ? { model } : {}) })));
    }
    // Nothing given: your brain picks the project (and asks you when it isn't clear)
    const text = `Start a worker agent for this task. Pick the right project with your tools; if it isn't clear which one, ask me first.\n\nTask: ${task}`;
    res.status(202).json(toAgent(await brain(req, "POST", "/brain/messages", { text })));
  });

  router.post("/agents/:id/stop", async (req, res) => {
    res.json(toAgent(await brain(req, "POST", `/agents/${agentId(req)}/stop`)));
  });

  router.delete("/agents/:id", async (req, res) => {
    await brain(req, "DELETE", `/agents/${agentId(req)}`);
    res.status(202).json({ removing: true });
  });

  router.post("/agents/:id/reply", async (req, res) => {
    const id = agentId(req);
    const { eventId, answer } = req.body ?? {};
    if (typeof eventId !== "string" || !ID.test(eventId)) throw new AppError("Which request are you answering?", 400, "VALIDATION_ERROR");
    const events = await brain(req, "GET", `/agents/${id}/events`);
    const asked = events.find((e) => e.id === eventId);
    if (!asked || !asked.data?.id) throw new AppError("That request isn't waiting any more.", 404, "NOT_FOUND");
    if (asked.kind === "permission") {
      const reply = PERMISSION_REPLY[answer];
      if (!reply) throw new AppError("Answer approve, always or deny.", 400, "VALIDATION_ERROR");
      return res.json(toAgent(await brain(req, "POST", `/agents/${id}/permissions/${asked.data.id}`, { reply })));
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

  router.get("/models", async (req, res) => res.json(await brain(req, "GET", "/models")));
  router.get("/settings", async (req, res) => res.json(await brain(req, "GET", "/settings")));
  router.put("/settings", async (req, res) => res.json(await brain(req, "PUT", "/settings", req.body ?? {})));

  return router;
}
