import { MongoNetworkError, MongoServerSelectionError } from "mongodb";

/**
 * Centralized error handler for Continuum
 */
export function errorMiddleware(err, req, res, next) {
  // Known, intentional errors
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Malformed JSON body (raised by express.json())
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid request body.",
      code: "INVALID_JSON",
    });
  }

  // Database unreachable
  if (err instanceof MongoNetworkError || err instanceof MongoServerSelectionError) {
    console.error("🔥 Database unavailable:", err);

    return res.status(503).json({
      error: "Service temporarily unavailable. Please try again.",
      code: "SERVICE_UNAVAILABLE",
    });
  }

  // Unknown / programmer errors
  console.error("🔥 Unhandled Error:", err);

  return res.status(500).json({
    error: "Internal Server Error",
    code: "INTERNAL_ERROR",
  });
}
