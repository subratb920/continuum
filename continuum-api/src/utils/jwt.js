import jwt from "jsonwebtoken";
import { ENV } from "../config/env.js";

const TOKEN_TTL = "7d";

export function signToken(payload) {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, ENV.JWT_SECRET);
}
