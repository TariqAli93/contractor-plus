// Single date-formatting helper used by the DOCX renderer. ISO-style is
// safe across locales and RTL/LTR; downstream changes (e.g. per-template
// date format pulled from settings) can replace this without touching
// every placeholder.
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
