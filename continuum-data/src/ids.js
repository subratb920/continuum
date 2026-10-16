import { ObjectId } from "mongodb";
import { badRequest } from "./errors.js";

/** An ObjectId from a 24-hex string (or an ObjectId from another driver copy). */
export function oid(value, what = "id") {
  const s = String(value ?? "");
  if (!ObjectId.isValid(s) || !/^[0-9a-f]{24}$/i.test(s)) throw badRequest(`That ${what} isn't valid.`, "BAD_ID");
  return new ObjectId(s);
}

export const hex = (id) => (id ? String(id) : null);
