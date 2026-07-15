import type { z } from 'zod';
import { ValidationError } from '../../../shared/errors/validation.error.js';

/**
 * Parse raw model arguments with a module's OWN zod schema — the single source
 * of validation truth (binding rule #4). A failure becomes a clean, Arabic
 * ValidationError with per-field messages (never a raw ZodError to the client).
 */
export function parseArgs<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const res = schema.safeParse(raw ?? {});
  if (!res.success) {
    const details: Record<string, string[]> = {};
    for (const issue of res.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      (details[key] ??= []).push(issue.message);
    }
    throw new ValidationError('تعذّر التحقق من بيانات الأداة.', details);
  }
  return res.data;
}

export function fmtMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

export function fmtText(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  return s.length ? s : '—';
}
