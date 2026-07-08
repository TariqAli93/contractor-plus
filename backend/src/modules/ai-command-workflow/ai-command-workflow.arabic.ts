// ============================================================
// Arabic normalization + confirm/cancel classification + LLM-output parsing.
//
// Extracted verbatim from the service so the unified assistant's pre-router and
// CommandTool share ONE source of truth for these. Drift here would desync the
// "ما في خطة بانتظار التأكيد" semantics between the legacy `/ai-command` route
// and the unified `/ai` route — the exact bug the unification is meant to prevent.
// ============================================================

import { llmInterpretationSchema } from './ai-command-workflow.schemas.js';
import type { LlmInterpretation } from './ai-command-workflow.types.js';

// ---------------------------------------------------------------------------
// Arabic confirm / cancel vocabulary
// ---------------------------------------------------------------------------

export const CONFIRM_WORDS = new Set([
  'نعم', 'اي', 'أي', 'إي', 'ايه', 'أيه', 'تمام', 'اكد', 'أكد', 'اكيد', 'أكيد',
  'توكل', 'نفذ', 'موافق', 'ماشي', 'اوكي', 'اوك', 'ok', 'okay', 'yes', 'y',
]);
export const CANCEL_WORDS = new Set([
  'لا', 'الغي', 'ألغي', 'إلغاء', 'الغاء', 'وقف', 'تراجع', 'كنسل', 'cancel', 'no', 'n',
]);

/** Strip tashkeel/tatweel + normalize alef/ya so "أكِّد" and "اكد" compare equal. */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[ً-ٰٟـ]/g, '') // diacritics + tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
    .toLowerCase();
}

export function classifyReply(text: string): 'confirm' | 'cancel' | 'other' {
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'other';
  // Cancel wins ties ("لا تنفذ" → cancel), so scan for a cancel word first.
  if (words.some((w) => CANCEL_WORDS.has(w))) return 'cancel';
  if (words.some((w) => CONFIRM_WORDS.has(w))) return 'confirm';
  return 'other';
}

/** Extract + validate the model's JSON. Tolerates surrounding prose/code fences. */
export function parseInterpretation(raw: string): LlmInterpretation | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = llmInterpretationSchema.safeParse(obj);
  return result.success ? (result.data as LlmInterpretation) : null;
}
