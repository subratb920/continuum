import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { addOnly, countsOf, pickProjects, remap } from "../src/sync/merge.js";

const L = "69d163aad7da5c2d67a8dc3b";
const P = "6ad02842f70bc74d11b1d5c3";

test("sync: only the sending account's id and Deploy tenant are moved; other ids and text stay", () => {
  const other = new ObjectId();
  const out = remap({ userId: new ObjectId(L), owner: L, tenantId: `u:${L}`, projectId: other, note: `made by ${L}`, list: [L, "x"], at: new Date(0) }, L, P);
  assert.equal(out.userId.toHexString(), P);
  assert.deepEqual([out.owner, out.tenantId, out.note, out.list], [P, `u:${P}`, `made by ${L}`, [P, "x"]]);
  assert.ok(out.projectId.equals(other));
  assert.ok(out.at instanceof Date);
});

test("sync: added only; records already there are kept (not counted as failures)", async () => {
  const dupErr = Object.assign(new Error("dup"), { result: { insertedCount: 2 }, writeErrors: [{ code: 11000 }] });
  assert.deepEqual(await addOnly({ insertMany: async () => Promise.reject(dupErr) }, [{}, {}, {}]), { added: 2, kept: 1 });
  assert.deepEqual(await addOnly({ insertMany: async (d) => ({ insertedCount: d.length }) }, [{}, {}]), { added: 2, kept: 0 });
  assert.deepEqual(await addOnly({ insertMany: async () => assert.fail("nothing to add") }, []), { added: 0, kept: 0 });
  const other = Object.assign(new Error("disk full"), { result: { insertedCount: 0 }, writeErrors: [{ code: 1 }] });
  await assert.rejects(addOnly({ insertMany: async () => Promise.reject(other) }, [{}]), /disk full/, "other errors aren't hidden");
});

test("sync: a project the account already has by name keeps its own; one an earlier sync brought still takes new bridges", () => {
  const a = new ObjectId();
  const b = new ObjectId();
  const here = [{ _id: new ObjectId(), name: "linkedin-clone" }, { _id: a, name: "continuum" }];
  const sent = [{ _id: new ObjectId(), name: "linkedin-clone" }, { _id: a, name: "continuum" }, { _id: b, name: "hello-gcp" }];
  const pick = pickProjects(sent, here);
  assert.deepEqual(pick.add.map((p) => p.name), ["hello-gcp"]);
  assert.deepEqual([...pick.ids].sort(), [String(a), String(b)].sort());
  assert.equal(pick.sameName, 1);
  assert.deepEqual(countsOf({ continuum: { projects: [1, 2] }, brain: { collections: { brain_agents: [1] } }, deploy: null, notes: ["x"] }), { continuum: { projects: 2 }, brain: { brain_agents: 1 }, deploy: null, notes: ["x"] });
});
