/**
 * Base application error.
 * All intentional errors must extend this.
 */
export class AppError extends Error {
  constructor(message, statusCode = 400, code = "APP_ERROR") {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}
