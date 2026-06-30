import { Prisma } from '@prisma/client';

/**
 * Money / Decimal discipline.
 *
 * Every financial calculation goes through decimal.js — specifically the very
 * instance Prisma bundles and already returns for `Decimal` columns
 * (`Prisma.Decimal`). That avoids a second, non-interoperable Decimal type and,
 * critically, the `Number()` float drift the audit (§8/§9) flagged: values stay
 * `Money` end-to-end and are serialized to a fixed-precision STRING only at the
 * DTO boundary — the same shape a raw Prisma entity already serializes to.
 *
 * Wrapping `Prisma.Decimal` here (instead of reaching for it ad-hoc) keeps the
 * one coupling point in a single file, so swapping the engine later is local.
 */

const Decimal = Prisma.Decimal;

export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | number | string;

/** Coerce any money-ish value into a Decimal. */
export function money(value: MoneyInput): Money {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Sum a list of money values; an empty list yields 0. */
export function sumMoney(values: MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** Round to `dp` decimal places, half-up. Defaults to 2 (currency minor units). */
export function round(value: MoneyInput, dp = 2): Money {
  return money(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Serialize to a fixed-precision string for the wire (DTO output). */
export function toMoneyString(value: MoneyInput, dp = 2): string {
  return money(value).toFixed(dp);
}

/** Serialize a nullable money value, preserving null. */
export function toMoneyStringOrNull(
  value: MoneyInput | null | undefined,
  dp = 2,
): string | null {
  return value === null || value === undefined ? null : toMoneyString(value, dp);
}
