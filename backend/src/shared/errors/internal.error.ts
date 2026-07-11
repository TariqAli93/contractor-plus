import { AppError } from './app-error.js';

/**
 * 500 — an unexpected server-side failure. The client receives a generic,
 * detail-free message; the underlying `cause` is carried for logging ONLY and is
 * never serialized to the wire (BACKEND.md §14.2, §14.3).
 *
 * A fired database `CHECK` constraint maps here rather than to a 400, because a
 * `CHECK` violation means a domain guard was missing — a bug in our code, not
 * bad input. It must be logged loudly, not blamed on the caller.
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error', cause?: unknown, code = 'INTERNAL_ERROR') {
    super(500, code, message, undefined, true, cause);
  }
}
