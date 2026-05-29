// Display-only normalization for native `<input type="date">` and Vuetify
// v-text-field type="date", both of which require a strict `yyyy-MM-dd`
// string. The backend returns full ISO timestamps (e.g.
// "2025-05-27T00:00:00.000Z"); binding those raw triggers
// "value does not conform to the required format yyyy-MM-dd" in the browser.
//
// Important: this is one-way (server → input). The form payload sent back to
// the server is the same `yyyy-MM-dd` string the user typed — backends already
// `z.coerce.date()` it, so no extra serialization on submit is needed.

export function toDateInput(value?: string | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return formatDate(value);
  }
  // Already in `yyyy-MM-dd` shape — fast path, no Date construction.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return formatDate(d);
}

function formatDate(d: Date): string {
  // Use the UTC components so a value like "2025-05-27T00:00:00.000Z"
  // stays on May 27 regardless of the user's timezone. Dates that came from
  // the user are already in their local interpretation, so this is the
  // intuitive result for both "today" and "API value" cases.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
