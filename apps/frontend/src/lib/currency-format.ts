import type { Currency } from '@/types/settings';

// Sensible fallback used when the settings store hasn't loaded yet, or for
// non-authenticated screens. Matches the previous MoneyDisplay behaviour
// (en-US grouping, 2 fraction digits, no symbol).
export const FALLBACK_FORMAT = {
  symbol: '',
  code: '',
  symbolPosition: 'AFTER' as const,
  decimalPrecision: 2,
  thousandSeparator: ',',
  decimalSeparator: '.',
};

export interface FormatMoneyOptions {
  currency?: Currency | null;
  // Explicit override that supersedes the currency's symbol. Useful for
  // call sites that pass a string code via the legacy `currency` prop on
  // MoneyDisplay.
  symbolOverride?: string;
  // Hide the currency symbol entirely (e.g. when rendered inside an input
  // adornment that already shows it).
  hideSymbol?: boolean;
}

export function formatMoney(
  amount: number | string | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (amount === null || amount === undefined) return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '—';

  const c = opts.currency;
  const precision = c?.decimalPrecision ?? FALLBACK_FORMAT.decimalPrecision;
  const thousand = c?.thousandSeparator ?? FALLBACK_FORMAT.thousandSeparator;
  const decimal = c?.decimalSeparator ?? FALLBACK_FORMAT.decimalSeparator;

  const number = formatNumber(n, precision, thousand, decimal);

  if (opts.hideSymbol) return number;

  const symbol = opts.symbolOverride ?? c?.symbol ?? '';
  if (!symbol) return number;

  const position = c?.symbolPosition ?? FALLBACK_FORMAT.symbolPosition;
  // A thin non-breaking space sits between number and symbol so the two
  // never wrap onto different lines.
  const NBSP = ' ';
  return position === 'BEFORE' ? `${symbol}${NBSP}${number}` : `${number}${NBSP}${symbol}`;
}

function formatNumber(
  n: number,
  precision: number,
  thousandSep: string,
  decimalSep: string,
): string {
  const negative = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(precision);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);
  const body = precision > 0 && fracPart ? `${grouped}${decimalSep}${fracPart}` : grouped;
  return negative ? `-${body}` : body;
}
