import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preRoute } from '../../src/modules/ai-assistant/pre-router.js';

// Pure, DB-free unit tests for the deterministic pre-router — the guard against
// classifying real commands as canned help/greeting/status replies.

test('exact help phrases are classified as help', () => {
  const phrases = [
    'شنو أكدر اسوي وياك',
    'شنو تكدر تسوي',
    'ساعدني',
    'شنو اوامرك',
    'ماذا تستطيع أن تفعل',
    'ما هي الأوامر المتاحة',
  ];
  for (const p of phrases) assert.equal(preRoute(p, false).kind, 'help', p);
});

test('a plain greeting is classified as greeting', () => {
  assert.equal(preRoute('شلونك', false).kind, 'greeting');
  assert.equal(preRoute('هلا', false).kind, 'greeting');
});

test('a whole-message status question is classified as status', () => {
  assert.equal(preRoute('وين وصلنا', false).kind, 'status');
});

test('smalltalk is recognized with its topic', () => {
  assert.deepEqual(preRoute('شكرا', false), { kind: 'smalltalk', topic: 'thanks' });
  assert.deepEqual(preRoute('منو انت', false), { kind: 'smalltalk', topic: 'identity' });
  assert.deepEqual(preRoute('باي', false), { kind: 'smalltalk', topic: 'farewell' });
});

// The blocker: a help/greeting word FOLLOWED BY an actionable command must route
// as a real command (passthrough), NOT a canned answer.
test('a help word before a real command routes as a command (passthrough)', () => {
  assert.equal(preRoute('ساعدني أضيف عميل باسم علي', false).kind, 'passthrough');
});

test('a greeting before a real command routes as a command (passthrough)', () => {
  assert.equal(preRoute('هلا سوّي مشروع باسم الزهراء', false).kind, 'passthrough');
});

test('ordinary commands are passthrough, never a canned answer', () => {
  assert.equal(preRoute('أضف عميل باسم علي', false).kind, 'passthrough');
  assert.equal(preRoute('شكد مصاريف مشروع دار المنصور؟', false).kind, 'passthrough');
  assert.equal(preRoute('سجل دفعة لمشروع الزهراء', false).kind, 'passthrough');
});

test('bare confirm/cancel acts on a pending plan, else reports no pending', () => {
  assert.equal(preRoute('نعم', true).kind, 'confirm');
  assert.equal(preRoute('لا', true).kind, 'cancel');
  assert.equal(preRoute('نعم', false).kind, 'no_pending');
});
