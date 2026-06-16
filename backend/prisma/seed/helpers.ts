// Date helpers — deterministic relative to "now" at seed time so that running
// the seed twice on different days both produces realistic data.

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function daysAgo(n: number): Date {
  const d = startOfDay(new Date());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

export function monthsAgo(n: number): Date {
  const d = startOfDay(new Date());
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}
