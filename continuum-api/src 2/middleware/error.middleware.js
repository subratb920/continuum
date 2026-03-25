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

  // Unknown / programmer errors
  console.error("🔥 Unhandled Error:", err);

  return res.status(500).json({
    error: "Internal Server Error",
    code: "INTERNAL_ERROR",
  });
}
