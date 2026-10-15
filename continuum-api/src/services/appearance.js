// src/services/appearance.js
//
// The user's colour theme, kept with their account so it's the same on every
// device and in Continuum Deploy (which follows it). Dark unless chosen.

import { ObjectId } from "mongodb";
import { AppError } from "../errors/AppError.js";

export const THEME_IDS = ["light", "dark", "gray", "system"];
export const DEFAULT_THEME = "dark";

/** { theme, chosen }: chosen is false while the user has never picked one (theme is then the default) */
export async function readTheme(db, userId) {
  const user = await db.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { "appearance.theme": 1 } });
  const theme = user?.appearance?.theme;
  return THEME_IDS.includes(theme) ? { theme, chosen: true } : { theme: DEFAULT_THEME, chosen: false };
}

export async function getTheme(db, userId) {
  return (await readTheme(db, userId)).theme;
}

/** Saves a theme; returns it. Anything not in THEME_IDS is refused. */
export async function setTheme(db, userId, theme) {
  if (!THEME_IDS.includes(theme)) {
    throw Object.assign(new AppError(`theme must be one of ${THEME_IDS.join(", ")}.`, 400, "VALIDATION_ERROR"), { field: "theme" });
  }
  await db.collection("users").updateOne({ _id: new ObjectId(userId) }, { $set: { "appearance.theme": theme, "appearance.updatedAt": new Date() } });
  return theme;
}
