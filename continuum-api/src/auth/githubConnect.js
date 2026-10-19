import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";

/** What Continuum asks GitHub for: "repo" lists private repositories too (OAuth Apps have no read-only private scope). */
export const GITHUB_SCOPE = "user:email repo";

const COLLECTION = "github_connect_states";
const VALID_MS = 60 * 60_000;

/** A one-time code for Connect GitHub (an hour): GitHub hands it back, so the callback knows which account to connect. */
export async function newConnectState(db, userId) {
  const state = randomBytes(24).toString("hex");
  await db.collection(COLLECTION).insertOne({ state, userId: new ObjectId(String(userId)), createdAt: new Date() });
  return state;
}

/** The account a Connect GitHub code was made for (used once), or null: a plain GitHub sign-in, or an old code. */
export async function takeConnectState(db, state) {
  if (typeof state !== "string" || !state) return null;
  const found = await db.collection(COLLECTION).findOneAndDelete({ state });
  return found && Date.now() - found.createdAt.getTime() < VALID_MS ? found.userId : null;
}
