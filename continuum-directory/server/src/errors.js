/**
 * An error meant for the person: its message is shown as it is. Hosts treat
 * it as theirs (isOperational, statusCode), so it passes through their error
 * handling unchanged.
 */
export class DirectoryError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.name = "DirectoryError";
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.isOperational = true;
    if (field) this.field = field;
  }
}

export const notFound = (what = "That", code = "NOT_FOUND") => new DirectoryError(404, code, `${what} wasn't found.`);
export const badRequest = (message, code = "VALIDATION_ERROR", field) => new DirectoryError(400, code, message, field);
export const forbidden = (message, code = "FORBIDDEN") => new DirectoryError(403, code, message);
export const conflict = (message, code = "CONFLICT", field) => new DirectoryError(409, code, message, field);
