import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCallback } from "../src/services/supportRequests.js";

test("callback: a phone number with a country code is kept as typed", () => {
  const c = normalizeCallback({ name: " Subrat ", phone: "+91 98765 43210", bestTime: "evening", timezone: "Asia/Kolkata", note: " after 6 " });
  assert.deepEqual(c, { name: "Subrat", phone: "+91 98765 43210", bestTime: "evening", timezone: "Asia/Kolkata", note: "after 6" });
});

test("callback: an unknown time becomes as soon as possible", () => {
  assert.equal(normalizeCallback({ phone: "(415) 555-0100", bestTime: "midnight" }).bestTime, "asap");
});

test("callback: numbers that can't be called are refused", () => {
  for (const phone of ["", "12345", "call me", "+1 555 555 555 555 555 55", "<script>"]) {
    assert.throws(() => normalizeCallback({ phone }), /phone number/, phone);
  }
});

test("callback: long fields are cut", () => {
  const c = normalizeCallback({ phone: "+44 20 7946 0958", name: "x".repeat(300), note: "y".repeat(5000) });
  assert.equal(c.name.length, 100);
  assert.equal(c.note.length, 1000);
});
