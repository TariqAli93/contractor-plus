import { AppError } from '../../shared/errors/app-error.js';

/**
 * DomainRuleViolation — a request that is well-formed but illegal in the current
 * state ("only a draft contract can be approved").
 *
 * WHY 422 AND NOT 409: a 409 Conflict means the world changed under you — retry
 * with fresh data and it may succeed. A rule violation means what you asked for
 * is not a legal thing to ask; retrying is pointless. The client renders them
 * differently, so the server must distinguish them (BACKEND.md §14.1). Hence
 * `retryable = false`.
 *
 * WHY IT EXTENDS THE EXISTING `AppError`: the error-handler plugin already
 * serializes `AppError` to the wire envelope the SPA's axios layer expects
 * (`{ statusCode, code, message, details, reqId }`). Introducing a parallel
 * error type would mean two envelopes; this reuses the one that exists.
 *
 * `code` is stable, SCREAMING_SNAKE, and never localized. `message` is a
 * developer-facing English sentence; the Arabic user string is the frontend's
 * job, keyed off `code` (BACKEND.md §14.2), because the same code must render in
 * a toast, an AI preview, and a Windows toast, and three translations drift.
 */
export class DomainRuleViolation extends AppError {
  // Retrying an illegal request cannot make it legal, so `retryable` stays the
  // base default of `false` (a 422 is deliberately non-retryable).
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details);
  }
}
