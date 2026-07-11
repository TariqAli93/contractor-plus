import { AppError } from './app-error.js';

/**
 * 504 — an operation (an upstream call, a database transaction) exceeded its
 * time budget. Retryable (BACKEND.md §14.1, §14.3 — Prisma `P2028`).
 */
export class TimeoutError extends AppError {
  constructor(message = 'The operation timed out', code = 'UPSTREAM_TIMEOUT', details?: unknown) {
    super(504, code, message, details, true);
  }
}
