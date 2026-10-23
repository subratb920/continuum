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
  const spaces = [];
  const events = [
    { id: PER, agentId: W, kind: "permission", text: "edit: src/footer.html", data: { id: "per_1", type: "edit", detail: "--- a\n+++ b\n@@\n-old\n+new\n+more" } },
    { id: QUE, agentId: W, kind: "question", text: "Which colour?", data: { id: "que_1", questions: [{ question: "Which colour?", options: ["Blue", "Red"] }] } },
  ];
  const agent = { id: W, kind: "worker", state: "working" };
  return {
    calls,
    spaces,
    call: async ({ userId, spaceId }, method, path, body) => {
      spaces.push(spaceId);
      calls.push(`${userId} ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
      if (path === "/compute-catalog" && method === "GET") return { status: 200, data: { available: true, region: "us-central1", cpuMachines: [{ name: "n2-standard-8", vCPU: 8, memoryGb: 32, allowedByQuota: true }], gpuMachines: [], gpus: [], quotas: [] } };
      if (path === "/agents" && method === "GET") return { status: 200, data: [agent] };
      if (path === "/brain") return { status: 200, data: { brain: { id: "c".repeat(24), kind: "core", state: "idle" }, events: [] } };
      if (path.endsWith("/events")) return { status: 200, data: events };
      if (path === "/pending") return { status: 200, data: events.filter((e) => !e.answeredAt) };
      if (path === "/agents" && body?.projectId === "nope") return { status: 404, data: { error: { code: "NOT_FOUND", message: "No such project." } } };
      return { status: 200, data: agent };
    },
    send: async ({ userId, spaceId }, path, bytes) => {
      spaces.push(spaceId);
      // The route now streams the upload straight through, so `bytes` is a readable stream (drain it to size it)
      let len = 0;
      if (bytes && typeof bytes[Symbol.asyncIterator] === "function") for await (const c of bytes) len += c.length;
      else if (bytes && typeof bytes.length === "number") len = bytes.length;
      calls.push(`${userId} SEND ${path} ${len} bytes`);
      if (path.startsWith(`/projects/${"e".repeat(24)}`)) return { status: 404, data: { error: { code: "NOT_FOUND", message: "No such project." } } };
      return { status: 201, data: { id: "s".repeat(24), files: 3, bytes: len } };
    },
    stream: async (caller, query) => {
      spaces.push(caller?.spaceId);
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
  // One model for all: a model sent for one worker isn't passed on
  await s.call("POST", "/agents", { task: "Tests", projectId: "p".repeat(24), model: "opencode/big-pickle" });
  assert.match(b.calls.at(-1), /POST \/agents {"projectId":"p{24}","task":"Tests"}$/);
  // An interval goal or a repository (a retry) starts the worker directly, not through the brain
  await s.call("POST", "/agents", { task: "", goal: { bridgeId: "b".repeat(24), goalId: "g1", text: "ignored" } });
  assert.match(b.calls.at(-1), /POST \/agents {"goal":{"bridgeId":"b{24}","goalId":"g1"},"task":""}/);
  await s.call("POST", "/agents", { task: "Again", repo: "octo/shop" });
  assert.match(b.calls.at(-1), /POST \/agents {"repo":"octo\/shop","task":"Again"}/);
  const refused = await s.call("POST", "/agents", { task: "x", projectId: "nope" });
  assert.deepEqual([refused.status, (await refused.json()).error], [404, "No such project."]);
  assert.equal((await s.call("POST", "/agents", { task: " " })).status, 400);
  assert.ok(b.calls.every((c) => c.startsWith("1".repeat(24)) || c.startsWith("stream")), "always as the signed-in user");
  // With no active org space, the tenant is the user's personal space ("u:<userId>"), forwarded on every call
  assert.ok(b.spaces.every((sp) => sp === `u:${"1".repeat(24)}`), "the personal space is forwarded as X-Continuum-Space");
  s.close();
});

test("brain relay: the live GCP machine catalog passes through, scoped to the space", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  const cat = await (await s.call("GET", "/compute-catalog")).json();
  assert.equal(cat.available, true);
  assert.equal(cat.cpuMachines[0].name, "n2-standard-8");
  assert.match(b.calls.at(-1), /^1{24} GET \/compute-catalog$/);
  assert.equal(b.spaces.at(-1), `u:${"1".repeat(24)}`);
  s.close();
});

test("brain relay: Approve is allow once, Deny is reject; a question gets its option; nothing else is answerable", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "approve" })).status, 200);
  assert.match(b.calls.at(-1), /POST \/agents\/a+\/permissions\/per_1 {"reply":"once"}/);
  await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "deny" });
  assert.match(b.calls.at(-1), /{"reply":"reject"}/);
  await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "deny", message: " Keep the old footer " });
  assert.match(b.calls.at(-1), /{"reply":"reject","message":"Keep the old footer"}/, "a denial's note goes along");
  await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "approve", message: "ignored" });
  assert.match(b.calls.at(-1), /{"reply":"once"}$/, "only a denial carries a note");
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "maybe" })).status, 400);
  await s.call("POST", `/agents/${W}/reply`, { eventId: QUE, answer: "Blue" });
  assert.match(b.calls.at(-1), /POST \/agents\/a+\/questions\/que_1 {"answers":\[\["Blue"\]\]}/);
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: "9".repeat(24), answer: "approve" })).status, 404);
  assert.equal((await s.call("POST", `/agents/nope/reply`, { eventId: PER, answer: "approve" })).status, 404);
  // A worker's changes and its push go through as the signed-in user
  await s.call("GET", `/agents/${W}/changes`);
  assert.match(b.calls.at(-1), /^1{24} GET \/agents\/a{24}\/changes$/);
  await s.call("POST", `/agents/${W}/push`, { message: "Add discuss.md" });
  assert.match(b.calls.at(-1), /^1{24} POST \/agents\/a{24}\/push {"message":"Add discuss.md"}$/);
  assert.equal((await s.call("POST", `/agents/nope/push`, {})).status, 404);
  await s.call("GET", `/agents/${W}/file?path=${encodeURIComponent("docs/a b.md")}`);
  assert.match(b.calls.at(-1), /GET \/agents\/a{24}\/file\?path=docs%2Fa%20b\.md$/);
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

test("brain relay: what waits on you, however old; answering twice is harmless; streams resume by seq", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  const pending = await (await s.call("GET", "/pending")).json();
  assert.deepEqual(pending.map((e) => [e._id, e.data.target ?? e.data.options?.[0]]), [[PER, "src/footer.html"], [QUE, "Blue"]]);
  // A request found among what waits is answered without reading the agent's whole history
  b.calls.length = 0;
  assert.equal((await s.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "approve" })).status, 200);
  assert.ok(!b.calls.some((c) => c.includes("/events")), "found in /pending");
  // Answered already (another tab, a second click): 200, and nothing is sent to the agent
  const answered = fakeBrain();
  const t = await serve(answered);
  answered.call = ((orig) => async (u, m, p, body) => {
    const r = await orig(u, m, p, body);
    if (p === "/pending") return { status: 200, data: [] };
    if (p.endsWith("/events")) return { status: 200, data: r.data.map((e) => ({ ...e, answeredAt: "2026-10-17T10:00:00Z", answer: "once" })) };
    return r;
  })(answered.call);
  const again = await t.call("POST", `/agents/${W}/reply`, { eventId: PER, answer: "approve" });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).alreadyAnswered, true);
  assert.ok(!answered.calls.some((c) => c.includes("/permissions/")), "not sent again");
  // ?after= a seq goes to brain-api as is
  const ctl = new AbortController();
  const r = await fetch(`${s.base}/stream?after=42`, { signal: ctl.signal });
  await r.body.getReader().read();
  ctl.abort();
  assert.ok(b.calls.includes("stream after=42"));
  s.close();
  t.close();
});

test("brain relay: your project folder (.tar.gz from your computer) goes to the brain as it is; refusals pass on", async () => {
  const b = fakeBrain();
  const s = await serve(b);
  const gz = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
  const up = await fetch(`${s.base}/projects/${"d".repeat(24)}/snapshot`, { method: "POST", headers: { "Content-Type": "application/gzip" }, body: gz });
  assert.equal(up.status, 201);
  assert.deepEqual(await up.json(), { id: "s".repeat(24), files: 3, bytes: gz.length });
  assert.equal(b.calls.at(-1), `${"1".repeat(24)} SEND /projects/${"d".repeat(24)}/snapshots ${gz.length} bytes`);
  assert.equal((await fetch(`${s.base}/projects/${"e".repeat(24)}/snapshot`, { method: "POST", headers: { "Content-Type": "application/gzip" }, body: gz })).status, 404);
  assert.equal((await fetch(`${s.base}/projects/nope/snapshot`, { method: "POST", headers: { "Content-Type": "application/gzip" }, body: gz })).status, 404);
  assert.equal((await fetch(`${s.base}/projects/${"d".repeat(24)}/snapshot`, { method: "POST", headers: { "Content-Type": "application/gzip" }, body: new Uint8Array() })).status, 400);
  s.close();
});

/** Serve the relay with a fixed space (an org role) injected, to test the org-admin settings gate. */
async function serveInSpace(client, space) {
  const app = express();
  app.use(express.json());
  app.use("/brain", (req, _res, next) => ((req.user = { id: "1".repeat(24) }), (req.space = space), next()), createBrainRouter({ client }));
  app.use(errorMiddleware);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/brain`;
  const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { call, close: () => server.close() };
}

test("brain relay: in an org space only owners/admins may change settings; the page is told who may", async () => {
  const ORG = `o:${"c".repeat(24)}`;
  // A member sees the settings (read) but can't change them
  const member = await serveInSpace(fakeBrain(), { id: ORG, kind: "org", orgRole: "member" });
  const got = await (await member.call("GET", "/settings")).json();
  assert.deepEqual([got.space.kind, got.space.orgRole, got.space.canManage], ["org", "member", false]);
  const refused = await member.call("PUT", "/settings", { model: "ollama/qwen3:4b" });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, "NOT_ORG_ADMIN");
  member.close();
  // An admin may change them
  const admin = await serveInSpace(fakeBrain(), { id: ORG, kind: "org", orgRole: "admin" });
  assert.equal((await (await admin.call("GET", "/settings")).json()).space.canManage, true);
  assert.equal((await admin.call("PUT", "/settings", { model: "ollama/qwen3:4b" })).status, 200);
  admin.close();
  // A personal space is always manageable by its owner
  const personal = await serveInSpace(fakeBrain(), { id: `u:${"1".repeat(24)}`, kind: "user" });
  assert.equal((await personal.call("PUT", "/settings", { model: "ollama/qwen3:4b" })).status, 200);
  personal.close();
});
