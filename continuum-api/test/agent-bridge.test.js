import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentBridgeError, finish, giveVerdict, kindOf, planGoal, updateTask } from "../src/services/agentBridge.js";

const W = "c3".repeat(12);
const bridge = (over = {}) => ({ status: "draft", interval: { kind: "agent" }, sessionGoals: [{ id: "g1", text: "One", status: "untouched" }, { text: "Two (no id)", status: "untouched" }], ...over });
const throws = (fn, status) => assert.throws(fn, (e) => e instanceof AgentBridgeError && e.status === status);

test("agent bridge rules: only a running agent interval; goals found by id or position", () => {
  assert.equal(kindOf({ interval: {} }), "human");
  throws(() => planGoal({ ...bridge(), interval: { kind: "human" } }, "g1", [{ text: "x" }]), 409);
  throws(() => planGoal(bridge({ status: "finalized" }), "g1", [{ text: "x" }]), 409);
  const set = planGoal(bridge(), "g2", [{ text: "  Split it  " }]);
  assert.equal(set.sessionGoals[1].tasks[0].text, "Split it", "the second goal, by position");
  throws(() => planGoal(bridge(), "g1", [{ text: "" }]), 400);
  throws(() => planGoal(bridge(), "g1", Array.from({ length: 13 }, () => ({ text: "t" }))), 400);
});

test("agent bridge rules: tasks, verdicts, and stopping by the person or finishing by the brain", () => {
  let b = bridge();
  b = { ...b, ...planGoal(b, "g1", [{ id: "t1", text: "Do it" }]) };
  throws(() => updateTask(b, "g1", "t1", { agentId: "not-an-id" }), 400);
  b = { ...b, ...updateTask(b, "g1", "t1", { agentId: W, state: "failed", note: "Out of memory" }) };
  // The person stops it before every goal has a verdict: saved as it stands
  const stopped = finish(b, { by: "person" });
  assert.equal(stopped["interval.endedBy"], "person");
  assert.deepEqual(stopped.sessionGoals[0].agents, [{ agentId: W, name: `worker ${W.slice(-4)}`, task: "Do it", branch: null, state: "failed", error: "Out of memory" }]);
  assert.equal(stopped.sessionGoals[1].status, "untouched");
  // The brain can't finish until each goal has a verdict
  throws(() => finish(b), 409);
  b = { ...b, ...giveVerdict(b, "g1", { verdict: "incomplete", note: "The worker ran out of memory twice." }) };
  b = { ...b, ...giveVerdict(b, "g2", { verdict: "completed" }) };
  assert.deepEqual(b.sessionGoals.map((g) => g.status), ["incomplete", "completed"]);
  assert.equal(finish(b).status, "finalized");
});
