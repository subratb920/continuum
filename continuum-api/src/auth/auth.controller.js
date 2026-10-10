import { getDB } from "../config/db.js";
import { createAuthService } from "./auth.service.js";
import { AppError } from "../errors/AppError.js";

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

  const { token } = await auth.signup(email, password);

  res.status(201).json({ token });
}

export async function login(req, res) {
  const { email, password } = readCredentials(req.body);
  const auth = createAuthService(getDB());

  const { token, user } = await auth.login(email, password);

  req.log.info(
    {
      userId: user._id,
      email: user.email,
    },
    "User login successful"
  );

  res.json({ token });
}
