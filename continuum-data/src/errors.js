/** An error meant for the user: its message is shown as it is. */
export class DataError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "DataError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = "That") => new DataError(404, "NOT_FOUND", `${what} wasn't found.`);
export const badRequest = (message, code = "BAD_REQUEST") => new DataError(400, code, message);
export const conflict = (message, code = "CONFLICT") => new DataError(409, code, message);

/** A job failed for good: retrying won't help. */
export class PermanentJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PermanentJobError";
    this.code = code;
  }
}

/** A job failed for now (Docker or the network was away): the queue retries it. */
export class TemporaryJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TemporaryJobError";
    this.code = code;
  }
}
