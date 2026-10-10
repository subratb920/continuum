import { hashPassword, verifyPassword } from "../utils/hash.js";
import { signToken } from "../utils/jwt.js";
import { AppError } from "../errors/AppError.js";

// Same message for unknown email, wrong password and GitHub-only accounts,
// so the login form can't be used to discover which emails are registered.
const invalidCredentials = () =>
  new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");

/**
 * Auth Service
 * Responsible ONLY for identity creation & verification.
 */
export function createAuthService(db) {
  const users = db.collection("users");
  const execution = db.collection("execution_state");

  /**
   * Signup a new user
   * - creates user
   * - creates execution_state linked to user
   * - issues JWT
   */
  async function signup(email, password) {
    const existing = await users.findOne({ email });
    if (existing) {
      throw new AppError("Email already registered.", 409, "EMAIL_EXISTS");
    }

    const passwordHash = await hashPassword(password);

    // 1️⃣ Create user FIRST (no executionStateId yet)
    const userDoc = {
      email,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId: userId } = await users.insertOne(userDoc);

    // 2️⃣ Create execution state WITH userId (CRITICAL FIX)
    const executionStateDoc = {
      userId,
      activeProjectId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { insertedId: executionStateId } =
      await execution.insertOne(executionStateDoc);

    // 3️⃣ Link execution state back to user
    await users.updateOne(
      { _id: userId },
      {
        $set: { executionStateId },
      }
    );

    // 4️⃣ Issue JWT
    const token = signToken({
      userId,
      email,
      authProvider: "local", // 🔥 ADD
    });

    return { token };
  }

  /**
   * Login existing user
   * - verifies password
   * - issues JWT
   */
  async function login(email, password) {
    const user = await users.findOne({ email });

    // GitHub-only accounts have no passwordHash
    if (!user || !user.passwordHash) {
      throw invalidCredentials();
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw invalidCredentials();
    }

    const token = signToken({
      userId: user._id,
      email: user.email,
      authProvider: "local", // 🔥 ADD
    });

    return {
      token,
      user
    };
  }

  return {
    signup,
    login,
  };
}
