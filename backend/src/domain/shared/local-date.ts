/**
 * LocalDate — a calendar day with no time and no timezone.
 *
 * WHY THIS EXISTS: the schema draws a hard line between *instants* (a moment,
 * `timestamptz`) and *business days* (a due date, a cost date — DATABASE.md §3
 * "D3"). Modelling a business day as a JavaScript `Date` reintroduces exactly the
 * off-by-one-at-midnight bug that distinction exists to prevent: `new Date(
 * '2026-07-11')` is midnight UTC, which is the previous evening in Baghdad, so a
 * payment due on the 11th silently reads as due on the 10th for anyone west of
 * the meridian.
 *
 * A `LocalDate` is three integers. It never touches wall-clock time, so it cannot
 * drift. All arithmetic is done in UTC purely as a DST-free integer calendar; no
 * instant is ever implied.
 */
export class LocalDate {
  private constructor(
    readonly year: number,
    readonly month: number, // 1-12
    readonly day: number, // 1-31
  ) {}

  // ---- Construction -------------------------------------------------------

  /**
   * Build from calendar parts, validating that the day actually exists.
   * @throws {RangeError} for a non-calendar date such as 2026-02-30.
   */
  static of(year: number, month: number, day: number): LocalDate {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      throw new RangeError(`LocalDate.of: out of range ${year}-${month}-${day}`);
    }
    // Round-trip through UTC to reject impossible days (Feb 30 → Mar 2).
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
      utc.getUTCFullYear() !== year ||
      utc.getUTCMonth() !== month - 1 ||
      utc.getUTCDate() !== day
    ) {
      throw new RangeError(`LocalDate.of: not a calendar date ${year}-${month}-${day}`);
    }
    return new LocalDate(year, month, day);
  }

  /**
   * Parse a strict ISO `YYYY-MM-DD` string (the wire format for a business day).
   * @throws {RangeError} if the shape is wrong or the date is not real.
   */
  static parse(iso: string): LocalDate {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new RangeError(`LocalDate.parse: expected YYYY-MM-DD, got "${iso}"`);
    return LocalDate.of(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // ---- Arithmetic ---------------------------------------------------------

  /** A new date `n` days after this one (negative `n` moves backward). */
  addDays(n: number): LocalDate {
    const utc = new Date(Date.UTC(this.year, this.month - 1, this.day + n));
    return LocalDate.of(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }

  /** Signed whole-day difference `other - this`. Later `other` → positive. */
  daysUntil(other: LocalDate): number {
    const ms =
      Date.UTC(other.year, other.month - 1, other.day) -
      Date.UTC(this.year, this.month - 1, this.day);
    return Math.round(ms / 86_400_000);
  }

  /** Signed whole-day difference `this - other`. Later `this` → positive. */
  daysSince(other: LocalDate): number {
    return other.daysUntil(this);
  }

  // ---- Comparison ---------------------------------------------------------

  private ordinal(): number {
    return this.year * 10_000 + this.month * 100 + this.day;
  }

  compareTo(other: LocalDate): -1 | 0 | 1 {
    const a = this.ordinal();
    const b = other.ordinal();
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: LocalDate): boolean {
    return this.compareTo(other) === 0;
  }

  isBefore(other: LocalDate): boolean {
    return this.compareTo(other) < 0;
  }

  isAfter(other: LocalDate): boolean {
    return this.compareTo(other) > 0;
  }

  // ---- Egress -------------------------------------------------------------

  /** ISO `YYYY-MM-DD`. */
  toString(): string {
    const mm = String(this.month).padStart(2, '0');
    const dd = String(this.day).padStart(2, '0');
    return `${this.year}-${mm}-${dd}`;
  }

  toJSON(): string {
    return this.toString();
  }

  /**
   * A `Date` at UTC midnight, for the persistence adapter only. Prisma stores a
   * `@db.Date` column from the date part, so UTC midnight round-trips losslessly.
   */
  toUtcDate(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, this.day));
  }
}
