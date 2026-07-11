import type { Clock } from '../../application/ports/clock.js';
import { LocalDate } from '../../domain/shared/local-date.js';

/**
 * SystemClock — the production {@link Clock} adapter.
 *
 * `today()` derives the business day in a specific timezone using the built-in
 * `Intl` calendar (no dependency added — RULE 16). This is the concrete reason
 * the `Clock` port exists: "today" in Asia/Baghdad is a different calendar day
 * from "today" in UTC for three hours of every day, and a payment's due date
 * must follow the contractor's calendar, not the server's (DATABASE.md §3).
 *
 * The instant source is injectable so time-dependent use cases ("overdue",
 * "due in 7 days") are deterministically testable.
 */
export class SystemClock implements Clock {
  constructor(
    private readonly timezone: string,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  now(): Date {
    return this.nowFn();
  }

  today(): LocalDate {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(this.now());

    const part = (type: 'year' | 'month' | 'day'): number => {
      const found = parts.find((p) => p.type === type);
      if (!found) throw new Error(`SystemClock: missing ${type} for timezone ${this.timezone}`);
      return Number(found.value);
    };

    return LocalDate.of(part('year'), part('month'), part('day'));
  }
}
