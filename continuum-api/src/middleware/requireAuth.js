import { verifyToken } from "../utils/jwt.js";
import { ObjectId } from "mongodb";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = header.split(" ")[1];

  try {
    const payload = verifyToken(token);

    req.user = {
  id:
    typeof payload.userId === "string"
      ? new ObjectId(payload.userId)
      : payload.userId,
};

    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
