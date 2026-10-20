// src/services/supportRequests.js
//
// "Request a callback" from the Contact us card: who, which number, when
// suits them, and a short note. Kept in support_requests for the team, who
// see them in the Directory (Callback requests) and get each one by email
// (when mail is set up: services/mailer.js).

import { ObjectId } from "mongodb";
import { AppError } from "../errors/AppError.js";
import { mailTeam } from "./mailer.js";

export const SUPPORT_COLLECTION = "support_requests";
export const BEST_TIMES = ["asap", "morning", "afternoon", "evening"];
/** A request is new until someone on the team has called. */
export const CALLBACK_STATUSES = ["new", "called"];
const TIME_TEXT = { asap: "as soon as possible", morning: "morning (9–12)", afternoon: "afternoon (12–17)", evening: "evening (17–20)" };
/** At most this many callback requests per person per day. */
export const DAILY_LIMIT = 5;

const invalid = (message, field) => Object.assign(new AppError(message, 400, "VALIDATION_ERROR"), { field });

/** Checks a callback request; returns its clean fields. */
export function normalizeCallback(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 100) : "";
  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  const digits = phone.replace(/[^\d]/g, "");
  if (!/^\+?[\d\s().-]{6,25}$/.test(phone) || digits.length < 6 || digits.length > 15) {
    throw invalid("Enter a phone number we can call, with its country code (e.g. +91 98765 43210).", "phone");
  }
  const bestTime = BEST_TIMES.includes(b.bestTime) ? b.bestTime : "asap";
  const timezone = typeof b.timezone === "string" ? b.timezone.slice(0, 64) : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
  // Which app the request came from (Continuum, or Continuum Deploy's Contact us)
  const source = b.source === "deploy" ? "deploy" : "continuum";
  return { name, phone, bestTime, timezone, note, source };
}

/** The team's email about a new callback request: { subject, text, replyTo }. */
export function callbackEmail(doc, directoryUrl = process.env.DIRECTORY_APP_URL) {
  const who = doc.name || doc.email || "Someone";
  const lines = [
    `${who} asked for a callback${doc.source === "deploy" ? " from Continuum Deploy" : ""}.`,
    "",
    `Phone: ${doc.phone}`,
    `Best time: ${TIME_TEXT[doc.bestTime] ?? doc.bestTime}${doc.timezone ? ` (${doc.timezone})` : ""}`,
    `Name: ${doc.name || "—"}`,
    `Account: ${doc.email ?? "—"}`,
    "",
    doc.note ? `What it's about:\n${doc.note}` : "No note.",
  ];
  if (directoryUrl) lines.push("", `All callback requests: ${directoryUrl.replace(/\/+$/, "")}/callbacks`);
  return { subject: `Callback request: ${who.replace(/[\r\n]+/g, " ")}, ${doc.phone}`, text: lines.join("\n"), replyTo: doc.email ?? undefined };
}

const view = (d) => ({
  id: String(d._id),
  userId: d.userId ? String(d.userId) : null,
  email: d.email ?? null,
  name: d.name ?? "",
  phone: d.phone,
  bestTime: d.bestTime,
  timezone: d.timezone ?? null,
  note: d.note ?? "",
  source: d.source ?? "continuum",
  status: d.status ?? "new",
  calledAt: d.calledAt ?? null,
  calledBy: d.calledBy ?? null,
  createdAt: d.createdAt,
});

export function createSupportService(db, { notify = mailTeam, log } = {}) {
  const col = db.collection(SUPPORT_COLLECTION);

  async function requestCallback(user, body, now = new Date()) {
    const fields = normalizeCallback(body);
    const userId = new ObjectId(user.id);
    const since = new Date(now.getTime() - 24 * 3600_000);
    const recent = await col.countDocuments({ userId, type: "callback", createdAt: { $gte: since } });
    if (recent >= DAILY_LIMIT) {
      throw new AppError("You've asked for several callbacks today; the team will be in touch. You can also write to us.", 429, "TOO_MANY_REQUESTS");
    }
    const account = await db.collection("users").findOne({ _id: userId }, { projection: { email: 1 } });
    const doc = { type: "callback", userId, email: account?.email ?? null, ...fields, status: "new", createdAt: now };
    const { insertedId } = await col.insertOne(doc);
    // The team's email: sent after the answer, never holding it up or failing it
    Promise.resolve()
      .then(() => notify(callbackEmail(doc)))
      .then((sent) => sent && log?.info?.({ requestId: String(insertedId) }, "Callback request emailed to the team"))
      .catch((err) => log?.warn?.({ err: err.message, requestId: String(insertedId) }, "Callback request not emailed"));
    return { id: insertedId, ...fields, createdAt: now };
  }

  /** The team's list (Directory): newest first; status "new" | "called" | "" (all). */
  async function listCallbacks({ status = "", limit = 200 } = {}) {
    const q = { type: "callback", ...(CALLBACK_STATUSES.includes(status) ? { status } : {}) };
    const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const [items, open] = await Promise.all([col.find(q).sort({ createdAt: -1 }).limit(n).toArray(), col.countDocuments({ type: "callback", status: "new" })]);
    return { items: items.map(view), open };
  }

  /** Marked called (by whom, when), or back to new. */
  async function setCallbackStatus(id, status, by, now = new Date()) {
    if (!ObjectId.isValid(String(id))) throw new AppError("No such callback request.", 404, "NOT_FOUND");
    if (!CALLBACK_STATUSES.includes(status)) throw invalid(`Status is one of: ${CALLBACK_STATUSES.join(", ")}.`, "status");
    const set = status === "called" ? { status, calledAt: now, calledBy: by?.email ?? null } : { status, calledAt: null, calledBy: null };
    const d = await col.findOneAndUpdate({ _id: new ObjectId(String(id)), type: "callback" }, { $set: set }, { returnDocument: "after" });
    if (!d) throw new AppError("No such callback request.", 404, "NOT_FOUND");
    return view(d);
  }

  return { requestCallback, listCallbacks, setCallbackStatus };
}
