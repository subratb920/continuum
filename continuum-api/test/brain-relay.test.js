import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createBrainRouter, diffSize, streamToken, toEvent } from "../src/brain/routes.js";
import { errorMiddleware } from "../src/middleware/error.middleware.js";

const W = "a".repeat(24);
const PER = "e".repeat(24);
const QUE = "f".repeat(24);

/** A fake brain-api: records calls, answers like the real one. */
function fakeBrain() {
  const calls = [];
  const events = [
    { id: PER, agentId: W, kind: "permission", text: "edit: src/footer.html", data: { id: "per_1", type: "edit", detail: "--- a\n+++ b\n@@\n-old\n+new\n+more" } },
    { id: QUE, agentId: W, kind: "question", text: "Which colour?", data: { id: "que_1", questions: [{ question: "Which colour?", options: ["Blue", "Red"] }] } },
  ];
  const agent = { id: W, kind: "worker", state: "working" };
  return {
    calls,
    call: async (userId, method, path, body) => {
      calls.push(`${userId} ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
      if (path === "/agents" && method === "GET") return { status: 200, data: [agent] };
      if (path === "/brain") return { status: 200, data: { brain: { id: "c".repeat(24), kind: "core", state: "idle" }, events: [] } };
      if (path.endsWith("/events")) return { status: 200, data: events };
      if (path === "/agents" && body?.projectId === "nope") return { status: 404, data: { error: { code: "NOT_FOUND", message: "No such project." } } };
      return { status: 200, data: agent };
    },
    stream: async (_u, query) => {
      calls.push(`stream ${new URLSearchParams(query)}`);
      const body = new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          c.enqueue(enc.encode(`retry: 3000\n\nid: ${PER}\nevent: event\ndata: ${JSON.stringify(events[0])}\n\nevent: agent\ndata: ${JSON.stringify(agent)}\n\n`));
          c.close();
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
  };
}

async function serve(client) {
  const app = express();
  app.use(express.json());
  // Signed in as user 1 (requireAuth's place; the stream token is checked by requireAuth in the app)
  app.use("/brain", streamToken, (req, _res, next) => ((req.user = { id: "1".repeat(24) }), next()), createBrainRouter({ client }));
  app.use(errorMiddleware);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/brain`;
  const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { call, base, close: () => server.close() };
}

test("brain relay: shapes for the screen (_id; a question's options; a permission's target and change size)", () => {
  assert.equal(diffSize("--- a\n+++ b\n@@\n-x\n+y\n+z"), "+2 −1");
  assert.equal(diffSize("npm test"), null);
  const p = toEvent({ id: PER, kind: "permission", text: "edit: src/a.js", data: { id: "per_1", detail: "--- a\n+++ b\n+x" } });
  assert.deepEqual([p._id, p.data.target, p.data.diff], [PER, "src/a.js", "+1 −0"]);
  assert.deepEqual(toEvent({ id: QUE, kind: "question", text: "?", data: { questions: [{ options: ["A", "B"] }] } }).data.options, ["A", "B"]);
});

test("brain relay: the stream's ?token= becomes the sign-in header for the stream only", () => {
  const run = (path, query, headers = {}) => {
    const req = { path, query, headers };
    streamToken(req, {}, () => {});
    return req.headers.authorization;
  };
  assert.equal(run("/stream", { token: "jwt" }), "Bearer jwt");
  assert.equal(run("/agents", { token: "jwt" }), undefined);
  assert.equal(run("/stream", { token: "jwt" }, { authorization: "Bearer real" }), "Bearer real");
});

test("brain relay: your brain and workers; a worker on a project, or your brain picks the project; refusals pass on", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  const list = await (await s.call("GET", "/agents")).json();
  assert.deepEqual(list.map((a) => [a._id.slice(0, 1), a.kind]), [["c", "core"], ["a", "worker"]]);
  assert.equal((await s.call("POST", "/agents", { task: "Add a footer", projectId: "p".repeat(24) })).status, 201);
  assert.equal((await s.call("POST", "/agents", { task: "Add a footer" })).status, 202);
  assert.match(b.calls.at(-1), /POST \/brain\/messages .*Pick the right project.*Task: Add a footer/);
  const refused = await s.call("POST", "/agents", { task: "x", projectId: "nope" });
  assert.deepEqual([refused.status, (await refused.json()).error], [404, "No such project."]);
  assert.equal((await s.call("POST", "/agents", { task: " " })).status, 400);
  assert.ok(b.calls.every((c) => c.startsWith("1".repeat(24)) || c.startsWith("stream")), "always as the signed-in user");
  s.close();
});

test("brain relay: Approve is allow once, Deny is reject; a question gets its option; nothing else is answerable", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "approve" })).status, 200);
  assert.match(b.calls.at(-1), /POST \/agents\/a+\/permissions\/per_1 {"reply":"once"}/);
  await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "deny" });
  assert.match(b.calls.at(-1), /{"reply":"reject"}/);
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "maybe" })).status, 400);
  await s.call("POST", `/agents/${W}/reply`, { eventId: QUE, answer: "Blue" });
  assert.match(b.calls.at(-1), /POST \/agents\/a+\/questions\/que_1 {"answers":\[\["Blue"\]\]}/);
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: "9".repeat(24), answer: "approve" })).status, 404);
  assert.equal((await s.call("POST", `/agents/nope/reply`, { eventId: PER, answer: "approve" })).status, 404);
  s.close();
});

test("brain relay: the live stream passes through in the screen's shapes; a fresh page asks for history", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  const text = await (await fetch(`${s.base}/stream`)).text();
  assert.match(text, /retry: 3000/);
  const block = text.split("\n\n").find((b) => b.startsWith(`id: ${PER}\nevent: event\ndata: `));
  const e = JSON.parse(block.split("data: ")[1]);
  assert.deepEqual([e._id, e.data.target, e.data.diff], [PER, "src/footer.html", "+2 −1"]);
  assert.match(text, /event: agent\ndata: .*"_id":"a{24}"/);
  assert.equal(b.calls.at(-1), "stream history=1");
  await (await fetch(`${s.base}/stream?after=${PER}`)).text();
  assert.equal(b.calls.at(-1), `stream after=${PER}`);
  s.close();
});
