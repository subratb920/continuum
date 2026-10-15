// src/services/supportRequests.js
//
// "Request a callback" from the Contact us card: who, which number, when
// suits them, and a short note. Kept in support_requests for the team.

import { ObjectId } from "mongodb";
import { AppError } from "../errors/AppError.js";

export const SUPPORT_COLLECTION = "support_requests";
export const BEST_TIMES = ["asap", "morning", "afternoon", "evening"];
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
  return { name, phone, bestTime, timezone, note };
}

export function createSupportService(db) {
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
    return { id: insertedId, ...fields, createdAt: now };
  }

  return { requestCallback };
}
