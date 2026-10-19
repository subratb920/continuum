import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { GITHUB_SCOPE, newConnectState, takeConnectState } from "../src/auth/githubConnect.js";
import { clientPageUrl, githubAuthorizeUrl } from "../src/config/urls.js";

/** Just enough of a database: one collection of { state, userId, createdAt }. */
function fakeDb() {
  const docs = [];
  const collection = {
    insertOne: async (d) => void docs.push(d),
    findOneAndDelete: async ({ state }) => {
      const i = docs.findIndex((d) => d.state === state);
      return i < 0 ? null : docs.splice(i, 1)[0];
    },
  };
  return { docs, collection: () => collection };
}

test("Connect GitHub: the code names the account that asked, and works once", async () => {
  const db = fakeDb();
  const userId = new ObjectId();
  const state = await newConnectState(db, userId.toHexString());
  assert.match(state, /^[0-9a-f]{48}$/);
  assert.ok((await takeConnectState(db, state)).equals(userId));
  assert.equal(await takeConnectState(db, state), null, "used once");
});

test("Connect GitHub: a plain sign-in (no code), an unknown code or one older than an hour connects nothing", async () => {
  const db = fakeDb();
  assert.equal(await takeConnectState(db, undefined), null);
  assert.equal(await takeConnectState(db, "nope"), null);
  const state = await newConnectState(db, new ObjectId());
  db.docs[0].createdAt = new Date(Date.now() - 61 * 60_000);
  assert.equal(await takeConnectState(db, state), null);
  const fresh = await newConnectState(db, new ObjectId());
  db.docs[0].createdAt = new Date(Date.now() - 59 * 60_000);
  assert.ok(await takeConnectState(db, fresh), "still good just under an hour");
});

test("Connect GitHub: GitHub's page carries the code; afterwards the import screen", () => {
  const before = { ...process.env };
  try {
    process.env.GITHUB_CLIENT_ID = "cid";
    process.env.CLIENT_ORIGIN = "http://localhost:45173";
    delete process.env.CLIENT_AUTH_CALLBACK_URL;
    const url = new URL(githubAuthorizeUrl(GITHUB_SCOPE, "abc"));
    assert.equal(url.searchParams.get("state"), "abc");
    assert.equal(url.searchParams.get("scope"), "user:email repo");
    assert.equal(new URL(githubAuthorizeUrl(GITHUB_SCOPE)).searchParams.has("state"), false, "a plain sign-in has none");
    assert.equal(clientPageUrl("/import"), "http://localhost:45173/import");
  } finally {
    process.env = before;
  }
});
