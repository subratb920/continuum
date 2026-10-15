import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { DEFAULT_THEME, getTheme, readTheme, setTheme } from "../src/services/appearance.js";

/** A users collection in memory: enough for findOne/updateOne on appearance */
function fakeDb() {
  const docs = new Map();
  const users = {
    findOne: async ({ _id }) => docs.get(String(_id)) ?? null,
    updateOne: async ({ _id }, { $set }) => {
      const doc = docs.get(String(_id)) ?? { _id };
      for (const [k, v] of Object.entries($set)) {
        const [a, b] = k.split(".");
        doc[a] = { ...(doc[a] ?? {}), [b]: v };
      }
      docs.set(String(_id), doc);
    },
  };
  return { collection: () => users };
}

test("appearance: dark until chosen, then the chosen theme", async () => {
  const db = fakeDb();
  const id = new ObjectId().toString();
  assert.equal(DEFAULT_THEME, "dark");
  assert.equal(await getTheme(db, id), "dark");
  assert.deepEqual(await readTheme(db, id), { theme: "dark", chosen: false });
  assert.equal(await setTheme(db, id, "gray"), "gray");
  assert.deepEqual(await readTheme(db, id), { theme: "gray", chosen: true });
});

test("appearance: unknown themes are refused", async () => {
  const db = fakeDb();
  const id = new ObjectId().toString();
  for (const bad of ["blue", "", null, 3, { theme: "dark" }]) {
    await assert.rejects(setTheme(db, id, bad), (e) => e.statusCode === 400 && e.field === "theme");
  }
});
