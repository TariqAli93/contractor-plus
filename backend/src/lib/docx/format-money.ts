import type { Currency, Prisma } from '@prisma/client';

// Backend-side money formatter for placeholder rendering. Mirrors the
// frontend's `formatMoney` so a generated DOCX shows the same number the
// user sees on screen. Pulled into its own file so the placeholder mapper
// stays small.

export interface FormatMoneyOptions {
  currency?: Pick<
    Currency,
    'symbol' | 'symbolPosition' | 'decimalPrecision' | 'thousandSeparator' | 'decimalSeparator'
  > | null;
  hideSymbol?: boolean;
}

const FALLBACK = {
  precision: 2,
  thousand: ',',
  decimal: '.',
  position: 'AFTER' as const,
};

export function formatMoney(
  amount: number | string | Prisma.Decimal | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (amount === null || amount === undefined) return '';
  const n = typeof amount === 'number' ? amount : Number(amount.toString());
  if (!Number.isFinite(n)) return '';

  const c = opts.currency;
  const precision = c?.decimalPrecision ?? FALLBACK.precision;
  const thousand = c?.thousandSeparator ?? FALLBACK.thousand;
  const decimal = c?.decimalSeparator ?? FALLBACK.decimal;
  const number = formatNumber(n, precision, thousand, decimal);

  if (opts.hideSymbol) return number;
  const symbol = c?.symbol ?? '';
  if (!symbol) return number;
  const position = c?.symbolPosition ?? FALLBACK.position;
  // Non-breaking space so number+symbol never wrap.
  const NBSP = ' ';
  return position === 'BEFORE' ? `${symbol}${NBSP}${number}` : `${number}${NBSP}${symbol}`;
}

function formatNumber(n: number, precision: number, thousandSep: string, decimalSep: string): string {
  const negative = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(precision);
  const [intPartRaw, fracPart] = fixed.split('.');
  const intPart = intPartRaw ?? '0';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);
  const body = precision > 0 && fracPart ? `${grouped}${decimalSep}${fracPart}` : grouped;
  return negative ? `-${body}` : body;
}
