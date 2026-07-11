import { AppError } from './app-error.js';

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT', retryable = false) {
    super(409, code, message, undefined, retryable);
  }
}
