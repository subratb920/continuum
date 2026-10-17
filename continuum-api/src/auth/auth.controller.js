import { getDB } from "../config/db.js";
import { createAuthService } from "./auth.service.js";
import { AppError } from "../errors/AppError.js";
import { recordLogin } from "../access/activity.js";

/** A sign-in record must never stop a sign-in. */
const note = (req, entry) => recordLogin(getDB(), { ...entry, req }).catch((err) => req.log.warn({ err: err.message }, "Sign-in not recorded"));

/**
 * Validate credentials from the request body.
 * Email is trimmed and lowercased so lookups are case-insensitive.
 */
function readCredentials(body) {
  const { email, password } = body ?? {};

  if (email == null || password == null || email === "" || password === "") {
    throw new AppError("Email and password are required.", 400, "VALIDATION_ERROR");
  }

  if (typeof email !== "string" || typeof password !== "string") {
    throw new AppError("Email and password must be text.", 400, "VALIDATION_ERROR");
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new AppError("Email and password are required.", 400, "VALIDATION_ERROR");
  }

  return { email: cleanEmail, password };
}

export async function signup(req, res) {
  const { email, password } = readCredentials(req.body);
  const auth = createAuthService(getDB());

  const { token, userId } = await auth.signup(email, password);
  await note(req, { userId, email, method: "email", signup: true });

  res.status(201).json({ token });
}

export async function login(req, res) {
  const { email, password } = readCredentials(req.body);
  const auth = createAuthService(getDB());

  let token, user;
  try {
    ({ token, user } = await auth.login(email, password));
  } catch (err) {
    // A refused sign-in is recorded too (for the admin: who tried, from where)
    if (err.code === "INVALID_CREDENTIALS" || err.statusCode === 401) await note(req, { email, method: "email", ok: false, reason: "wrong email or password" });
    throw err;
  }
  await note(req, { userId: user._id, email: user.email, method: "email" });

  req.log.info(
    {
      userId: user._id,
      email: user.email,
    },
    "User login successful"
  );

  res.json({ token });
}
