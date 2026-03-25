import { verifyToken } from "../utils/jwt.js"; // ✅
import { ENV } from "../config/env.js";

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = verifyToken(token, ENV.JWT_SECRET);

    req.user = {
      id: payload.userId,
      email: payload.email,
    };

    next();
  } catch (err) {
    req.user = null;
    next();
  }
}
