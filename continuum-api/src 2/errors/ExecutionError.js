import { AppError } from "./AppError.js";

export class ExecutionError extends AppError {
  constructor(message) {
    super(message, 409, "EXECUTION_VIOLATION");
  }
}
