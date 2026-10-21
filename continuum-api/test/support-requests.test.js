import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackEmail, normalizeCallback, normalizeLead, leadEmail } from "../src/services/supportRequests.js";

test("callback: a phone number with a country code is kept as typed", () => {
  const c = normalizeCallback({ name: " Subrat ", phone: "+91 98765 43210", bestTime: "evening", timezone: "Asia/Kolkata", note: " after 6 " });
  assert.deepEqual(c, { name: "Subrat", phone: "+91 98765 43210", bestTime: "evening", timezone: "Asia/Kolkata", note: "after 6", source: "continuum" });
});

test("callback: requests from Continuum Deploy are marked as such; anything else counts as Continuum", () => {
  assert.equal(normalizeCallback({ phone: "+91 98765 43210", source: "deploy" }).source, "deploy");
  assert.equal(normalizeCallback({ phone: "+91 98765 43210", source: "elsewhere" }).source, "continuum");
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

test("callback email: who, the number, when, the note, and a link to the Directory", () => {
  const m = callbackEmail({ name: "Subrat", email: "s@example.com", phone: "+91 98765 43210", bestTime: "evening", timezone: "Asia/Kolkata", note: "Pricing", source: "deploy" }, "https://directory.continuum-console.one/");
  assert.equal(m.subject, "Callback request: Subrat, +91 98765 43210");
  assert.equal(m.replyTo, "s@example.com");
  assert.match(m.text, /from Continuum Deploy/);
  assert.match(m.text, /Best time: evening \(17–20\) \(Asia\/Kolkata\)/);
  assert.match(m.text, /What it's about:\nPricing/);
  assert.match(m.text, /https:\/\/directory\.continuum-console\.one\/callbacks$/);
});

test("callback email: without a name it says the account; a name can't break the subject line", () => {
  assert.equal(callbackEmail({ email: "s@example.com", phone: "+44 20 7946 0958", bestTime: "asap" }, "").subject, "Callback request: s@example.com, +44 20 7946 0958");
  assert.doesNotMatch(callbackEmail({ name: "A\r\nBcc: x@y.z", phone: "+44 20 7946 0958" }, "").subject, /[\r\n]/);
});

test("lead: a valid email is kept lowercased; name/note/page trimmed and capped", () => {
  const l = normalizeLead({ email: " Me@Company.COM ", name: "  Subrat  ", note: " interested ", page: "/teams?utm=x" });
  assert.deepEqual(l, { email: "me@company.com", name: "Subrat", note: "interested", page: "/teams" });
});

test("lead: a missing or malformed email is refused", () => {
  assert.throws(() => normalizeLead({ email: "not-an-email" }), /email/);
  assert.throws(() => normalizeLead({}), /email/);
});

test("lead: the team's email names who and the page, and replies to them", () => {
  const m = leadEmail({ email: "me@company.com", name: "Subrat", note: "hi", page: "/ai-workflows" }, "https://continuum-console.one");
  assert.match(m.subject, /New lead: Subrat/);
  assert.equal(m.replyTo, "me@company.com");
  assert.match(m.text, /\/ai-workflows/);
});
