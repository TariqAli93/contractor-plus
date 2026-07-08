// ============================================================
// Deterministic pre-router — runs BEFORE any LLM call. It short-circuits the
// turns that must never cost a paid model round-trip or be misread as a project
// query: help/capability questions, greetings, status questions, and the
// confirm/cancel vocabulary. Everything else is `passthrough` (a real command).
//
// It reuses ai-command's normalizeArabic + classifyReply (one source of truth
// with the legacy route), so the "ما في خطة بانتظار التأكيد" semantics can't drift.
// ============================================================

import { CANCEL_WORDS, CONFIRM_WORDS, classifyReply, normalizeArabic } from '../ai-command-workflow/ai-command-workflow.arabic.js';

export type PreRoute =
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'status' }
  | { kind: 'no_pending' } // an explicit confirm/cancel word, but nothing is parked
  | { kind: 'passthrough' };

// All hints are normalized once at load so matching is normalize-vs-normalize.
const HELP_HINTS = [
  'شنو تكدر تسوي', 'شنو اكدر اسوي وياك', 'شنو اكدر اسوي', 'شنو تقدر تسوي', 'شنو تقدر تفعل',
  'ماذا تستطيع ان تفعل', 'ماذا تستطيع', 'شنو اوامرك', 'ما هي الاوامر المتاحه', 'الاوامر المتاحه',
  'شنو ممكن تسوي', 'شلون تكدر تساعدني', 'ساعدني', 'المساعده', 'مساعده', 'help',
].map(normalizeArabic);

const GREETING_HINTS = [
  'السلام عليكم', 'سلام عليكم', 'هلا', 'هلو', 'مرحبا', 'اهلا', 'صباح الخير', 'مساء الخير',
  'صباح النور', 'شلونك', 'شخبارك', 'hello', 'hi ', 'hey',
].map(normalizeArabic);

const STATUS_HINTS = [
  'وين وصلنا', 'وين وصلت', 'شنو الوضع', 'شكو عندي معلق', 'شنو المعلق', 'شنو معلق',
  'حالة الجلسه', 'شنو الحالة',
].map(normalizeArabic);

function matchesAny(norm: string, hints: string[]): boolean {
  return hints.some((h) => norm.includes(h));
}

/** True only when the WHOLE message is one/two confirm-or-cancel tokens — so
 *  "لا" is caught but "لا تسوي مشروع" (a real command) is not. */
function isBareReplyToken(norm: string): boolean {
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) => CONFIRM_WORDS.has(w) || CANCEL_WORDS.has(w));
}

export function preRoute(text: string, hasPendingPlan: boolean): PreRoute {
  const norm = normalizeArabic(text);
  const reply = classifyReply(text);

  // 1) With a plan parked, confirm/cancel words act on it (legacy semantics).
  if (hasPendingPlan) {
    if (reply === 'confirm') return { kind: 'confirm' };
    if (reply === 'cancel') return { kind: 'cancel' };
  }

  // 2) Help / greeting / status — deterministic, no LLM. Allowed even with a plan
  //    parked (the orchestrator answers WITHOUT discarding the parked plan).
  if (matchesAny(norm, HELP_HINTS)) return { kind: 'help' };
  if (matchesAny(norm, GREETING_HINTS)) return { kind: 'greeting' };
  if (matchesAny(norm, STATUS_HINTS)) return { kind: 'status' };

  // 3) A bare confirm/cancel token with nothing parked → the "no pending" reply.
  //    This is the ONLY site that produces that message, so it can never appear
  //    after an ordinary question.
  if (!hasPendingPlan && reply !== 'other' && isBareReplyToken(norm)) return { kind: 'no_pending' };

  // 4) A real command / query → hand off to the LLM routing.
  return { kind: 'passthrough' };
}
