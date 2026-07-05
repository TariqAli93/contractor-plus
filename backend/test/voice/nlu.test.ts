import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';

const nlu = new RuleBasedNluProvider();
const ctx = { locale: 'ar' as const };

test('recognises create_project across phrasings (no string matching)', async () => {
  for (const phrase of [
    'سوي مشروع',
    'أنشئ مشروع',
    'افتح مشروع جديد',
    'أريد مشروع جديد',
    'سويلي مشروع بيت',
  ]) {
    const r = await nlu.interpret(phrase, ctx);
    assert.equal(r.intent, VoiceIntent.CREATE_PROJECT, `phrase: ${phrase}`);
    assert.ok(r.confidence >= 0.4, `confidence for: ${phrase}`);
  }
});

test('extracts entities alongside the intent', async () => {
  const r = await nlu.interpret('سوي مشروع بيت مساحة 100 متر واجهة 5 ونزال 20', ctx);
  assert.equal(r.intent, VoiceIntent.CREATE_PROJECT);
  assert.equal(r.entityBag.area, 100);
  assert.equal(r.entityBag.frontage, 5);
  assert.equal(r.entityBag.depth, 20);
  assert.equal(r.entityBag.projectType, 'house');
});

test('recognises navigation and disambiguates from create', async () => {
  const r = await nlu.interpret('افتح المشاريع', ctx);
  assert.equal(r.intent, VoiceIntent.NAVIGATE);
  assert.equal(r.entityBag.route, '/projects');
});

test('recognises create_contract with a customer name', async () => {
  const r = await nlu.interpret('سوي عقد باسم أحمد محمد رفعت', ctx);
  assert.equal(r.intent, VoiceIntent.CREATE_CONTRACT);
  assert.equal(r.entityBag.customerName, 'أحمد محمد رفعت');
});

test('falls back to UNKNOWN with zero confidence on unrelated speech', async () => {
  const r = await nlu.interpret('الجو حار اليوم وأكلت تفاحة', ctx);
  assert.equal(r.intent, VoiceIntent.UNKNOWN);
  assert.equal(r.confidence, 0);
});

test('recognises a help request', async () => {
  const r = await nlu.interpret('شلون استخدمك', ctx);
  assert.equal(r.intent, VoiceIntent.HELP);
});
