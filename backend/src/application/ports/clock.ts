import type { LocalDate } from '../../domain/shared/local-date.js';

/**
 * Clock — the port through which the application reads time.
 *
 * WHY A PORT AND NOT `new Date()`: "overdue", "due in 7 days", and "signed today"
 * are testable only if the current time is injectable. A use case that calls
 * `Date.now()` directly can be tested for one thing — whatever the wall clock
 * says the instant the test runs. The infrastructure adapter is `SystemClock`;
 * tests pass a fixed clock.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;

  /** Today as a business day, in the organisation's timezone. */
  today(): LocalDate;
}
