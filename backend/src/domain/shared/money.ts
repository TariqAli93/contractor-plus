import { Prisma } from '@prisma/client';

/**
 * Money — an immutable value object for monetary amounts.
 *
 * WHY A VALUE OBJECT (and not the free functions in `lib/money.ts`):
 * arithmetic, comparison, and allocation of money are behaviour that belongs
 * *with* the data, not scattered across services. Encapsulating them here means
 * the invariants (immutability, fixed serialization scale, no float leakage)
 * hold everywhere by construction rather than by discipline.
 *
 * WHY `Prisma.Decimal` INTERNALLY: it is the very decimal.js instance Prisma
 * returns for `Decimal` columns, so there is exactly one decimal engine in the
 * process and no lossy conversion at the persistence boundary.
 *
 * WHAT THIS DELIBERATELY DOES NOT EXPOSE: a `toNumber()`. Converting money to a
 * float is the one operation that reintroduces IEEE-754 drift (`0.1 + 0.2`), so
 * the type refuses to offer it. Money leaves the domain only as a fixed-precision
 * STRING, at the DTO boundary. This is the money discipline of the audit (§8/§9)
 * made structural.
 *
 * CURRENCY: intentionally absent. The system is single-currency today and money
 * columns carry no currency code (DATABASE.md §17.3 defers multi-currency). When
 * that changes, a `currency` field is added here and every call site is forced by
 * the compiler to address it — which is the point of centralising the type.
 */

/** The decimal.js instance type, as bundled by Prisma. */
export type DecimalValue = Prisma.Decimal;

const D = Prisma.Decimal;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const TOWARD_ZERO = Prisma.Decimal.ROUND_DOWN;

/**
 * Fixed scale at which money is serialized and allocated. Matches the database
 * column type `NUMERIC(18,4)` (DATABASE.md §1.2). Display precision is a separate,
 * caller-supplied concern — see {@link Money.format}.
 */
export const MONEY_SCALE = 4;

/** Anything that can be coerced into {@link Money}. */
export type MoneyInput = Money | DecimalValue | number | string;

export class Money {
  private constructor(private readonly amount: DecimalValue) {}

  // ---- Construction -------------------------------------------------------

  /**
   * Build a {@link Money} from any money-ish input.
   * @throws {RangeError} if the value is not a finite number.
   */
  static of(value: MoneyInput): Money {
    if (value instanceof Money) return value;
    const d = value instanceof D ? value : new D(value);
    if (!d.isFinite()) {
      throw new RangeError(`Money.of: value is not finite: ${String(value)}`);
    }
    return new Money(d);
  }

  /** The additive identity. */
  static zero(): Money {
    return new Money(new D(0));
  }

  /** Sum a list; an empty list yields {@link Money.zero}. */
  static sum(values: readonly MoneyInput[]): Money {
    return values.reduce<Money>((acc, v) => acc.plus(v), Money.zero());
  }

  /** The smaller of two amounts. */
  static min(a: MoneyInput, b: MoneyInput): Money {
    const x = Money.of(a);
    const y = Money.of(b);
    return x.lessThanOrEqual(y) ? x : y;
  }

  /** The larger of two amounts. */
  static max(a: MoneyInput, b: MoneyInput): Money {
    const x = Money.of(a);
    const y = Money.of(b);
    return x.greaterThanOrEqual(y) ? x : y;
  }

  // ---- Arithmetic (all return new instances) ------------------------------

  plus(other: MoneyInput): Money {
    return new Money(this.amount.plus(Money.of(other).amount));
  }

  minus(other: MoneyInput): Money {
    return new Money(this.amount.minus(Money.of(other).amount));
  }

  /** Multiply by a dimensionless scalar (e.g. a quantity or a ratio). */
  times(scalar: number | string | DecimalValue): Money {
    return new Money(this.amount.times(new D(scalar)));
  }

  /**
   * Divide by a dimensionless scalar, rounding the result to {@link MONEY_SCALE}.
   * @throws {RangeError} on division by zero.
   */
  dividedBy(scalar: number | string | DecimalValue): Money {
    const d = new D(scalar);
    if (d.isZero()) throw new RangeError('Money.dividedBy: division by zero');
    return new Money(this.amount.div(d).toDecimalPlaces(MONEY_SCALE, HALF_UP));
  }

  negated(): Money {
    return new Money(this.amount.negated());
  }

  abs(): Money {
    return new Money(this.amount.abs());
  }

  /**
   * Split this amount across `weights`, losing not a single minor unit.
   *
   * Uses the largest-remainder method at {@link MONEY_SCALE}: each part gets the
   * floored proportional share, and the leftover units (there are at most
   * `weights.length - 1`) are handed to the parts with the largest fractional
   * remainders. The returned parts sum EXACTLY to the original — the property a
   * naive `total / n` rounded per-part violates.
   *
   * `allocate([1, 1, 1])` of 100.0000 → [33.3334, 33.3333, 33.3333].
   *
   * @throws {RangeError} if there are no weights, any weight is negative or
   *   non-finite, or the weights sum to zero.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new RangeError('Money.allocate: at least one weight is required');
    }
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new RangeError('Money.allocate: weights must be finite and non-negative');
    }
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
      throw new RangeError('Money.allocate: weights must sum to a positive value');
    }

    const factor = new D(10).pow(MONEY_SCALE); // 10_000 at scale 4
    const unit = new D(1).div(factor); // 0.0001
    const totalUnits = this.amount.times(factor).toDecimalPlaces(0, HALF_UP);

    const exact = weights.map((w) => totalUnits.times(w).div(totalWeight));
    const shares = exact.map((e) => e.toDecimalPlaces(0, TOWARD_ZERO));
    const distributed = shares.reduce((a, b) => a.plus(b), new D(0));

    let remaining = totalUnits.minus(distributed); // signed integer count of leftover units
    const step = remaining.isNegative() ? -1 : 1;

    // Order recipients by descending fractional remainder; ties by lower index.
    const order = exact
      .map((e, k) => ({ k, frac: e.minus(shares[k] ?? new D(0)).abs() }))
      .sort((a, b) => b.frac.comparedTo(a.frac) || a.k - b.k);

    let p = 0;
    while (!remaining.isZero() && order.length > 0) {
      const entry = order[p % order.length]!;
      shares[entry.k] = (shares[entry.k] ?? new D(0)).plus(step);
      remaining = remaining.minus(step);
      p += 1;
    }

    return shares.map((u) => new Money(u.times(unit)));
  }

  // ---- Comparison ---------------------------------------------------------

  compareTo(other: MoneyInput): -1 | 0 | 1 {
    return this.amount.comparedTo(Money.of(other).amount) as -1 | 0 | 1;
  }

  equals(other: MoneyInput): boolean {
    return this.amount.equals(Money.of(other).amount);
  }

  lessThan(other: MoneyInput): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: MoneyInput): boolean {
    return this.compareTo(other) <= 0;
  }

  greaterThan(other: MoneyInput): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: MoneyInput): boolean {
    return this.compareTo(other) >= 0;
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  // ---- Egress -------------------------------------------------------------

  /** The underlying decimal, for the persistence adapter only. */
  toDecimal(): DecimalValue {
    return this.amount;
  }

  /** Fixed-precision wire string at {@link MONEY_SCALE}, e.g. `"125000.0000"`. */
  toString(): string {
    return this.amount.toFixed(MONEY_SCALE);
  }

  /** Alias of {@link Money.toString} so `JSON.stringify` emits the wire string. */
  toJSON(): string {
    return this.toString();
  }

  /** Format for DISPLAY at a caller-chosen precision (never for storage). */
  format(decimalPlaces: number): string {
    return this.amount.toFixed(decimalPlaces);
  }
}
