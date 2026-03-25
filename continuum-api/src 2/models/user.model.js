import { ObjectId } from "mongodb";

export const USER_COLLECTION = "users";

/**
 * Create a new User document
 * Execution state is created separately during bootstrap or signup
 */
export function createUserDoc({ email, passwordHash }) {
  return {
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function toUserId(id) {
  return typeof id === "string" ? new ObjectId(id) : id;
}
