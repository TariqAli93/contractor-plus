import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurn, type TurnState } from '../../src/modules/ai-assistant/conversation-mode.js';

// Pure, DB-free tests for the classifier that runs BEFORE any routing or model
// call. Everything downstream trusts its verdict, so this is where the four
// conversation modes are pinned down.

const idle: TurnState = { hasPendingPlan: false, workflow: null };
const gathering: TurnState = { hasPendingPlan: false, workflow: 'brief' };
const drafting: TurnState = { hasPendingPlan: false, workflow: 'tool' };
const awaiting: TurnState = { hasPendingPlan: true, workflow: null };

function mode(text: string, state: TurnState = idle): string {
  const turn = classifyTurn(text, state);
  return turn.kind === 'control' ? `control:${turn.action}` : turn.mode;
}

// ── 1) General conversation ──────────────────────────────────────────────────
test('capability questions and greetings are general conversation', () => {
  for (const text of ['شنو تكدر تسوي', 'شنو أكدر اسوي وياك', 'ساعدني']) {
    assert.equal(mode(text), 'GENERAL', text);
  }
  for (const text of ['شلونك', 'مرحبا', 'هلا', 'السلام عليكم']) {
    assert.equal(mode(text), 'GENERAL', text);
  }
});

test('smalltalk is general conversation, not a command', () => {
  for (const text of ['شكرا', 'مشكور', 'منو انت', 'باي']) {
    assert.equal(mode(text), 'GENERAL', text);
  }
});

// ── 2) Questions ─────────────────────────────────────────────────────────────
test('read-only questions are classified as questions', () => {
  const questions = [
    'شنو المشاريع المتأخرة؟',
    'كم عدد العملاء؟',
    'كم مشروع متأخر؟',
    'شكد مصاريف مشروع الزهراء؟',
    'اعرض العقود المنتهية.',
  ];
  for (const text of questions) assert.equal(mode(text), 'QUESTION', text);
});

// A question ABOUT templates asks; it does not open the template workflow.
test('a question about existing templates is a question, not a workflow', () => {
  assert.equal(mode('اعرض قوالب التقدير'), 'QUESTION');
  assert.equal(mode('كم قالب تقدير عندي؟'), 'QUESTION');
});

// ── 3) Guided workflows ──────────────────────────────────────────────────────
test('template requests open a guided workflow', () => {
  const openers = ['سوّيلي قالب بيت', 'سوّيلي قالب بيت 75 متر', 'أريد قالب لمخزن', 'أريد تقدير لبناية', 'أريد تصميم قالب'];
  for (const text of openers) {
    const turn = classifyTurn(text, idle);
    assert.equal(turn.kind, 'conversation');
    if (turn.kind !== 'conversation' || turn.mode !== 'WORKFLOW') throw new Error(`${text} must open a workflow`);
    assert.equal(turn.stage, 'start');
  }
});

test('short answers inside a workflow continue it instead of restarting', () => {
  for (const answer of ['250 متر', 'طابقين', 'هيكل فقط', '250']) {
    const turn = classifyTurn(answer, gathering);
    assert.equal(turn.kind, 'conversation');
    if (turn.kind !== 'conversation' || turn.mode !== 'WORKFLOW') throw new Error(`${answer} must continue the workflow`);
    assert.equal(turn.stage, 'continue');
  }
});

test('a refinement continues a draft the tool already owns', () => {
  assert.equal(mode('زيد الاسمنت 10%', drafting), 'WORKFLOW');
});

test('a bare «لا» abandons a guided workflow', () => {
  assert.equal(mode('لا', gathering), 'control:cancel');
  // …but "لا" inside a sentence is an answer, not an abort.
  assert.equal(mode('لا أريد تشطيب', gathering), 'WORKFLOW');
});

test('ordinary conversation mid-workflow is answered without abandoning it', () => {
  assert.equal(mode('شنو تكدر تسوي', gathering), 'GENERAL');
  assert.equal(mode('نعم', gathering), 'WORKFLOW', 'a bare «نعم» is an answer, not a confirmation');
});

// ── 4) Mutating commands ─────────────────────────────────────────────────────
test('data changes are classified as commands', () => {
  const commands = ['أضف عميل', 'أنشئ مشروع', 'احذف مصروف', 'احذف آخر مصروف', 'سجل دفعة', 'عدل العقد'];
  for (const text of commands) assert.equal(mode(text), 'COMMAND', text);
});

test('a help word before a real command is still a command', () => {
  assert.equal(mode('ساعدني أضيف عميل باسم علي'), 'COMMAND');
  assert.equal(mode('هلا سوّي مشروع باسم الزهراء'), 'COMMAND');
});

// ── 5) Control words act only on something actually awaiting the user ────────
test('confirm/cancel act on a parked request, and only then', () => {
  assert.equal(mode('نعم', awaiting), 'control:confirm');
  assert.equal(mode('لا', awaiting), 'control:cancel');
  assert.equal(mode('نعم', idle), 'GENERAL', 'nothing parked → a plain reply, never a confirmation');
});
