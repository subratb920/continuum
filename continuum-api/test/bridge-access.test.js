import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { bridgeFor, mineFilter } from "../src/services/bridgeAccess.js";

const me = new ObjectId();
const other = new ObjectId();
const myProject = new ObjectId();
const sharedProject = new ObjectId(); // someone else's project I work on

/** Just enough of a database: bridges and projects by _id. */
function fakeDb(bridges, projects) {
  const match = (doc, q) => Object.entries(q).every(([k, v]) => (v && typeof v === "object" && "equals" in v ? v.equals(doc[k]) : doc[k] === v));
  return {
    collection: (name) => ({
      findOne: async (q) => (name === "bridges" ? bridges : projects).find((d) => match(d, q)) ?? null,
    }),
  };
}

test("a bridge is its starter's: another person's is never yours, even on your own project; one from before owners is the project owner's", async () => {
  const mine = { _id: new ObjectId(), projectId: sharedProject, userId: me };
  const theirsOnMyProject = { _id: new ObjectId(), projectId: myProject, userId: other };
  const oldOnMyProject = { _id: new ObjectId(), projectId: myProject };
  const oldOnTheirProject = { _id: new ObjectId(), projectId: sharedProject };
  const db = fakeDb([mine, theirsOnMyProject, oldOnMyProject, oldOnTheirProject], [{ _id: myProject, userId: me }, { _id: sharedProject, userId: other }]);

  assert.equal(await bridgeFor(db, mine._id.toHexString(), me), mine);
  assert.equal(await bridgeFor(db, theirsOnMyProject._id.toHexString(), me), null, "another person's bridge on my project");
  assert.equal(await bridgeFor(db, oldOnMyProject._id.toHexString(), me), oldOnMyProject, "from before owners, on my project");
  assert.equal(await bridgeFor(db, oldOnTheirProject._id.toHexString(), me), null, "from before owners, on someone else's project");
  assert.equal(await bridgeFor(db, "not-an-id", me), null);
});

test("my bridges: my own only; on my project also those from before owners", () => {
  assert.deepEqual(mineFilter(me, false), { userId: me });
  const f = mineFilter(me.toHexString(), true);
  assert.ok(f.$or[0].userId.equals(me));
  assert.deepEqual(f.$or[1], { userId: { $exists: false } });
});
