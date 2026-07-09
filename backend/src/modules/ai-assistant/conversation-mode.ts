// ============================================================
// Conversation Mode classifier — the ONE decision made before any routing,
// tool lookup, or LLM call. A turn is one of:
//
//   GENERAL   ordinary conversation (help, greeting, smalltalk, status).
//             Never plans, never previews, never touches a tool.
//   QUESTION  a read-only question about the user's data. Answered immediately;
//             may never park a mutation for confirmation.
//   WORKFLOW  a guided, multi-turn conversation (e.g. building an estimation
//             template). The assistant gathers what it needs, one question at a
//             time, and only previews once it has enough.
//   COMMAND   a data change. Preview → confirmation → execution.
//
// Plus one non-mode: `control` — a bare «نعم»/«لا» acting on something already
// awaiting the user, which is an answer to the assistant rather than a request.
//
// The classifier is deterministic and costs nothing: no model call, no DB read.
// Callers switch on the result and never re-derive how it was decided.
// ============================================================

import { CANCEL_WORDS, classifyReply, normalizeArabic } from '../ai-command-workflow/ai-command-workflow.arabic.js';
import { preRoute, type SmalltalkTopic } from './pre-router.js';

export type ConversationMode = 'GENERAL' | 'QUESTION' | 'WORKFLOW' | 'COMMAND';

/** Which canned reply a GENERAL turn earns. */
export type GeneralReply =
  | { reply: 'help' }
  | { reply: 'greeting' }
  | { reply: 'smalltalk'; topic: SmalltalkTopic }
  | { reply: 'status' }
  | { reply: 'no_pending' };

export type ConversationTurn =
  | { kind: 'control'; action: 'confirm' | 'cancel' }
  | ({ kind: 'conversation'; mode: 'GENERAL' } & GeneralReply)
  | { kind: 'conversation'; mode: 'QUESTION' }
  | { kind: 'conversation'; mode: 'WORKFLOW'; stage: 'start' | 'continue' }
  | { kind: 'conversation'; mode: 'COMMAND' };

export interface TurnState {
  /** A mutation is parked, awaiting the user's «نعم»/«لا». */
  hasPendingPlan: boolean;
  /** A guided conversation is open: the assistant is still gathering facts
   *  (`brief`), or a tool owns a live draft it is refining (`tool`). */
  workflow: 'brief' | 'tool' | null;
}

// Verbs that change data. Whole-token matching after normalization, so the
// noun "مصروف" or the help phrase "شنو أكدر اسوي" can never look like a mutation.
const MUTATION_VERBS = new Set(
  [
    'اضف', 'اضيف', 'ضيف', 'اضافه', 'سجل', 'اسجل', 'انشئ', 'انشي', 'انشا', 'احذف', 'امسح', 'شيل',
    'عدل', 'غير', 'بدل', 'حدث', 'اربط', 'خصص', 'ارفع', 'سوي', 'سويلي', 'سولي', 'اعمل', 'اكتب',
    'add', 'create', 'delete', 'remove', 'update', 'record',
  ].map(normalizeArabic),
);

// Interrogatives and read-only display verbs.
const QUESTION_MARKERS = new Set(
  [
    'شنو', 'شكد', 'كم', 'وين', 'منو', 'هل', 'ايش', 'ماهي', 'شلون', 'عدد', 'اعرض', 'اظهر', 'ورني',
    'جيبلي', 'لستلي', 'ماذا', 'كيف', 'what', 'how', 'many', 'show', 'list',
  ].map(normalizeArabic),
);

// A guided workflow exists for estimation templates. Substring matching (not
// whole-token) so "قوالب"/"تقديري" still trigger it.
const WORKFLOW_TRIGGERS = ['قالب', 'قوالب', 'تقدير', 'كميات', 'estimate', 'estimation', 'template'].map(
  normalizeArabic,
);

function tokens(norm: string): string[] {
  return norm
    .split(/\s+/)
    .map((tok) => tok.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
}

function hasMutationVerb(norm: string): boolean {
  return tokens(norm).some((tok) => MUTATION_VERBS.has(tok));
}

function hasQuestionMarker(norm: string): boolean {
  if (/[؟?]\s*$/u.test(norm)) return true;
  return tokens(norm).some((tok) => QUESTION_MARKERS.has(tok));
}

export function hasWorkflowTrigger(text: string): boolean {
  const norm = normalizeArabic(text);
  return WORKFLOW_TRIGGERS.some((trigger) => norm.includes(trigger));
}

/** True only when the WHOLE message is a bare cancel word — so a mid-workflow
 *  "لا" aborts the conversation, but "لا تريد تشطيب" stays an answer. */
function isBareCancel(norm: string): boolean {
  const words = tokens(norm);
  return words.length > 0 && words.length <= 2 && words.every((w) => CANCEL_WORDS.has(w));
}

export function classifyTurn(text: string, state: TurnState): ConversationTurn {
  const norm = normalizeArabic(text);
  const pre = preRoute(text, state.hasPendingPlan);

  // 1) A parked mutation owns the confirm/cancel vocabulary.
  if (pre.kind === 'confirm') return { kind: 'control', action: 'confirm' };
  if (pre.kind === 'cancel') return { kind: 'control', action: 'cancel' };

  // 2) Ordinary conversation is answered even mid-workflow — asking "شنو تكدر
  //    تسوي" while filling in a template does not abandon the template.
  if (pre.kind === 'help') return { kind: 'conversation', mode: 'GENERAL', reply: 'help' };
  if (pre.kind === 'greeting') return { kind: 'conversation', mode: 'GENERAL', reply: 'greeting' };
  if (pre.kind === 'smalltalk') return { kind: 'conversation', mode: 'GENERAL', reply: 'smalltalk', topic: pre.topic };
  if (pre.kind === 'status') return { kind: 'conversation', mode: 'GENERAL', reply: 'status' };

  // 3) Inside a guided conversation every other message continues it — a bare
  //    "لا" abandons it. The assistant never restarts and never re-classifies
  //    a short answer like "250 متر" as a fresh command.
  if (state.workflow) {
    if (isBareCancel(norm) && classifyReply(text) === 'cancel') return { kind: 'control', action: 'cancel' };
    return { kind: 'conversation', mode: 'WORKFLOW', stage: 'continue' };
  }

  // 4) A bare «نعم»/«لا» with nothing awaiting the user.
  if (pre.kind === 'no_pending') return { kind: 'conversation', mode: 'GENERAL', reply: 'no_pending' };

  const mutating = hasMutationVerb(norm);
  const asking = !mutating && hasQuestionMarker(norm);

  // 5) "سوّيلي قالب بيت" opens a guided conversation; "اعرض قوالب التقدير" is
  //    a question about existing ones.
  if (!asking && hasWorkflowTrigger(text)) return { kind: 'conversation', mode: 'WORKFLOW', stage: 'start' };

  if (asking) return { kind: 'conversation', mode: 'QUESTION' };

  // 6) Everything else is a request to act. The command tool's own classifier
  //    still decides query-vs-mutation, and the program still gates confirmation.
  return { kind: 'conversation', mode: 'COMMAND' };
}
