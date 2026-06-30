// Coerce a grid/API value (editor string, Prisma Decimal-string, or number)
// into a number — or null when blank/non-numeric. Shared by the grid column
// models so money/quantity parsing stays consistent across features.
export function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
