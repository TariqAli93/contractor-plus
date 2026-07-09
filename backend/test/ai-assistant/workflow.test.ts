import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAnswer,
  composeRequest,
  gapQuestion,
  newBrief,
  nextGap,
  readBrief,
  type EstimationBrief,
} from '../../src/modules/ai-assistant/workflow.js';

// Pure, DB-free, model-free tests for the guided-conversation state. Every fact
// the assistant collects here is extracted deterministically — a gathering turn
// must never cost an LLM round-trip.

/** Replay a conversation the way the orchestrator does: ask, answer, ask again. */
function converse(opening: string, answers: string[]): EstimationBrief {
  let brief = applyAnswer(newBrief(opening), opening);
  for (const answer of answers) {
    const gap = nextGap(brief);
    assert.ok(gap, `nothing left to ask, but the user still said "${answer}"`);
    brief = applyAnswer({ ...brief, awaiting: gap }, answer);
  }
  return brief;
}

test('an opening with no facts asks for everything, one bundle up front', () => {
  const brief = applyAnswer(newBrief('سوّيلي قالب بيت'), 'سوّيلي قالب بيت');
  assert.equal(brief.area, null);
  assert.equal(nextGap(brief), 'area');

  const question = gapQuestion('area', { opening: true });
  assert.match(question.question, /المساحة/);
  assert.match(question.question, /الطوابق/);
  assert.equal(question.missing.length, 3);
});

test('the spec conversation fills one slot per turn and only then has enough', () => {
  let brief = applyAnswer(newBrief('سوّيلي قالب بيت'), 'سوّيلي قالب بيت');
  assert.equal(nextGap(brief), 'area');

  brief = applyAnswer({ ...brief, awaiting: 'area' }, '250 متر');
  assert.deepEqual(brief.area, { value: 250, unit: 'متر' });
  assert.equal(nextGap(brief), 'floors', 'the area alone is not enough');

  brief = applyAnswer({ ...brief, awaiting: 'floors' }, 'طابقين');
  assert.equal(brief.floors, 2, 'the Arabic dual carries the number');
  assert.equal(nextGap(brief), 'scope');

  brief = applyAnswer({ ...brief, awaiting: 'scope' }, 'هيكل فقط');
  assert.equal(brief.scope, 'structural');
  assert.equal(nextGap(brief), null, 'now — and only now — there is enough to draft');
});

test('a bare number answers whatever was just asked', () => {
  const brief = converse('سوّيلي قالب بيت', ['250', '3', 'تشطيب كامل']);
  assert.deepEqual(brief.area, { value: 250, unit: 'متر مربع' });
  assert.equal(brief.floors, 3);
  assert.equal(brief.scope, 'full');
  assert.equal(nextGap(brief), null);
});

test('Arabic-Indic digits and م² parse like their ASCII twins', () => {
  const brief = applyAnswer(newBrief('قالب بيت ٧٥ م²'), 'قالب بيت ٧٥ م²');
  assert.deepEqual(brief.area, { value: 75, unit: 'متر مربع' });
});

test('an opening that already states everything needs no questions', () => {
  const text = 'أنشئ قالب تقدير لبناء بيت 200 متر طابقين هيكل فقط';
  const brief = applyAnswer(newBrief(text), text);
  assert.equal(nextGap(brief), null);
  assert.equal(brief.floors, 2);
  assert.equal(brief.scope, 'structural');
});

test('word numbers and a lone «طابق» count storeys', () => {
  assert.equal(applyAnswer(newBrief('x'), 'ثلاث طوابق').floors, 3);
  assert.equal(applyAnswer(newBrief('x'), 'طابق واحد').floors, 1);
});

test('a fence has no storeys, so it is never asked about them', () => {
  let brief = applyAnswer(newBrief('أريد قالب لسياج'), 'أريد قالب لسياج');
  assert.equal(nextGap(brief), 'area');
  brief = applyAnswer({ ...brief, awaiting: 'area' }, '30 متر');
  assert.equal(nextGap(brief), 'scope', 'floors are skipped for a linear structure');
});

test('«هيكل وتشطيب» is the full scope, not one of them', () => {
  assert.equal(applyAnswer(newBrief('x'), 'هيكل وتشطيب كامل').scope, 'full');
  assert.equal(applyAnswer(newBrief('x'), 'تشطيب فقط').scope, 'finishing');
});

test('the scope question offers the answers as options', () => {
  const question = gapQuestion('scope', { opening: false });
  const labels = (question.options ?? []).map((o) => o.label);
  assert.equal(labels.length, 3);
  // Clicking an option sends its label back — it must parse to that same scope.
  assert.equal(applyAnswer(newBrief('x'), labels[0]!).scope, 'structural');
});

test('the composed request keeps the user words and adds what was gathered', () => {
  const brief = converse('سوّيلي قالب بيت', ['250 متر', 'طابقين', 'هيكل فقط']);
  const composed = composeRequest(brief);
  assert.match(composed, /سوّيلي قالب بيت/, 'the original wording leads');
  assert.match(composed, /المساحة: 250 متر/);
  assert.match(composed, /عدد الطوابق: 2/);
  assert.match(composed, /نطاق العمل/);
});

test('a brief survives a round-trip through the session working state', () => {
  const brief = converse('سوّيلي قالب بيت', ['250 متر']);
  const restored = readBrief(JSON.parse(JSON.stringify(brief)));
  assert.deepEqual(restored, brief);
  assert.equal(readBrief({ draftId: 'abc', status: 'DRAFT_GENERATED' }), null, "a tool's own state is not a brief");
  assert.equal(readBrief(null), null);
});
