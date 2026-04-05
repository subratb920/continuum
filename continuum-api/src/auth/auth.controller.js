import { getDB } from "../config/db.js";
import { createAuthService } from "./auth.service.js";

export async function signup(req, res) {
  const { email, password } = req.body;
  const auth = createAuthService(getDB());

  const { token } = await auth.signup(email, password);

  res.status(201).json({ token });
}

export async function login(req, res) {
  const { email, password } = req.body;
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
