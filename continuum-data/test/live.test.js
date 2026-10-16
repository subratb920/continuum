import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ObjectId } from "mongodb";
import { setTimeout as sleep } from "node:timers/promises";
import { createLive } from "../src/api/live.js";
import { quietLog } from "./helpers.js";

/**
 * Live run events on a single MongoDB server (no replica set, as
 * continuum-api's database in the cloud): change streams aren't available,
 * so new events are read every second, each sent once, to its owner only.
 */
function singleServerDb() {
  const events = [];
  const db = {
    events,
    collection: () => ({
      watch() {
        const s = new EventEmitter();
        s.close = async () => {};
        setImmediate(() => s.emit("error", Object.assign(new Error("The $changeStream stage is only supported on replica sets"), { code: 40573 })));
        return s;
      },
      find(q) {
        const from = q._id.$gt;
        const list = events.filter((e) => e._id.toHexString() > from.toHexString());
        return { sort: () => ({ limit: () => ({ toArray: async () => list }) }) };
      },
    }),
  };
  return db;
}

function openFor(live, userId) {
  const got = [];
  const req = new EventEmitter();
  req.user = { id: userId };
  const res = { writeHead() {}, write: (s) => s.startsWith("id:") && got.push(JSON.parse(s.split("data: ")[1])) };
  live.handler(req, res);
  return { got, close: () => req.emit("close") };
}

const event = (userId, seq) => ({ _id: new ObjectId(), userId, runId: new ObjectId(), datasetId: new ObjectId(), seq, at: new Date(), kind: "log", message: `line ${seq}` });

test("without a replica set, new events still reach their owner, once each", async () => {
  const db = singleServerDb();
  const live = createLive(db, quietLog);
  live.start();
  const mine = openFor(live, "u1");
  const theirs = openFor(live, "u2");
  await sleep(50);
  db.events.push(event("u1", 1), event("u2", 1));
  await sleep(1300);
  db.events.push(event("u1", 2));
  await sleep(1300);
  await live.stop();
  mine.close();
  theirs.close();
  assert.deepEqual(mine.got.map((e) => e.message), ["line 1", "line 2"]);
  assert.deepEqual(theirs.got.map((e) => e.message), ["line 1"]);
});
