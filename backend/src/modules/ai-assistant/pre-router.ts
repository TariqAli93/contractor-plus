// ============================================================
// Deterministic pre-router — runs BEFORE any LLM call. It short-circuits the
// turns that must never cost a paid model round-trip or be misread as a project
// query: help/capability questions, greetings, status questions, and the
// confirm/cancel vocabulary. Everything else is `passthrough` (a real command).
//
// Matching is DELIBERATELY strict to avoid false positives: a help/greeting is
// only recognized when the WHOLE message is (essentially) that phrase AND it
// carries no actionable command word — so "ساعدني أضيف عميل باسم علي" and
// "هلا سوّي مشروع باسم الزهراء" route as real commands, not canned replies.
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

// Whole-message phrase sets (normalized). A turn matches only when its entire
// message equals one of these (after trimming trailing punctuation) — NOT a
// substring — so trailing content like a real command is never swallowed.
const HELP_PHRASES = new Set(
  [
    'شنو تكدر تسوي', 'شنو اكدر اسوي وياك', 'شنو اكدر اسوي', 'شنو تقدر تسوي', 'شنو تقدر تفعل',
    'ماذا تستطيع ان تفعل', 'ماذا تستطيع', 'شنو اوامرك', 'ما هي الاوامر المتاحه', 'الاوامر المتاحه',
    'شنو ممكن تسوي', 'شلون تكدر تساعدني', 'ساعدني', 'المساعده', 'مساعده', 'help',
  ].map(normalizeArabic),
);

const GREETING_PHRASES = new Set(
  [
    'السلام عليكم', 'سلام عليكم', 'سلام', 'هلا', 'هلو', 'مرحبا', 'اهلا', 'اهلين', 'صباح الخير',
    'مساء الخير', 'صباح النور', 'مساء النور', 'شلونك', 'شخبارك', 'hello', 'hi', 'hey',
  ].map(normalizeArabic),
);

const STATUS_PHRASES = new Set(
  [
    'وين وصلنا', 'وين وصلت', 'شنو الوضع', 'شنو وضعنا', 'شكو عندي معلق', 'شنو المعلق', 'شنو معلق',
    'حالة الجلسه', 'شنو الحالة',
  ].map(normalizeArabic),
);

// Actionable command words. If ANY appears as a WHOLE TOKEN, the message is a
// real command — never a help/greeting reply. Token (not substring) matching is
// essential: the help phrases contain "اسوي"/"تسوي", which must NOT be read as
// the action word "سوي".
const ACTION_WORDS = new Set(
  [
    'اضف', 'سوي', 'انشئ', 'سجل', 'احذف', 'عدل', 'غير', 'افتح', 'اعرض', 'شكد', 'كم', 'وين',
    'مشاريع', 'مشروع', 'عميل', 'عقد', 'دفعه', 'مصروف', 'قالب', 'تقدير',
  ].map(normalizeArabic),
);

/** Strip surrounding non-letter/digit chars from a token (e.g. "عميل،" → "عميل"). */
function cleanToken(tok: string): string {
  return tok.replace(/[^\p{L}\p{N}]/gu, '');
}

/** Normalize to a comparable whole-message phrase: collapse inner whitespace and
 *  drop trailing punctuation. */
function toPhrase(norm: string): string {
  return norm.replace(/\s+/g, ' ').trim().replace(/[؟?!.،,:;]+$/u, '').trim();
}

function containsActionWord(norm: string): boolean {
  return norm
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .some((tok) => ACTION_WORDS.has(tok));
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
  const phrase = toPhrase(norm);
  const reply = classifyReply(text);

  // 1) With a plan parked, confirm/cancel words act on it (legacy semantics).
  if (hasPendingPlan) {
    if (reply === 'confirm') return { kind: 'confirm' };
    if (reply === 'cancel') return { kind: 'cancel' };
  }

  // 2) Status — a whole-message status question. These legitimately contain query
  //    words ("وين"/"شكو"), so they are matched by exact phrase, before the guard.
  if (STATUS_PHRASES.has(phrase)) return { kind: 'status' };

  // 3) Help / greeting — ONLY when the whole message IS the phrase AND it carries
  //    no actionable command word. This is the guard that keeps
  //    "ساعدني أضيف عميل" / "هلا سوّي مشروع" as real commands (passthrough).
  if (!containsActionWord(norm)) {
    if (HELP_PHRASES.has(phrase)) return { kind: 'help' };
    if (GREETING_PHRASES.has(phrase)) return { kind: 'greeting' };
  }

  // 4) A bare confirm/cancel token with nothing parked → the "no pending" reply.
  //    This is the ONLY site that produces that message, so it can never appear
  //    after an ordinary question.
  if (!hasPendingPlan && reply !== 'other' && isBareReplyToken(norm)) return { kind: 'no_pending' };

  // 5) A real command / query → hand off to the LLM routing.
  return { kind: 'passthrough' };
}
