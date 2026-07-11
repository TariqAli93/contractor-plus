import { AppError } from './app-error.js';

/**
 * 429 — the caller exceeded a rate or spend limit. Retryable: the same request
 * may succeed once the window resets (BACKEND.md §14.1).
 */
export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMITED', details?: unknown) {
    super(429, code, message, details, true);
  }
}
