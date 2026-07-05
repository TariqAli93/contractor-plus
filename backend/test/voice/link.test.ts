import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';
import { extractEntities } from '../../src/modules/voice/nlu/entity-extractor.js';

const nlu = new RuleBasedNluProvider();

test('recognises the link intent across phrasings', async () => {
  for (const phrase of [
    'اربط هذا المشروع بالعقد',
    'اربط المشروع بالعقد رقم V-2026-0004',
    'ربط المشروع بالعقد',
    'اربطه بالعقد',
  ]) {
    const r = await nlu.interpret(phrase, { locale: 'ar' });
    assert.equal(r.intent, VoiceIntent.LINK_PROJECT_CONTRACT, phrase);
  }
});

test('extracts a contract reference after "رقم" plus the project area', () => {
  const { bag } = extractEntities('اربط مشروع بيت 100 بالعقد رقم V-2026-0004');
  assert.equal(bag.contractRef, 'V-2026-0004');
  assert.equal(bag.area, 100);
});

test('extracts a bare contract code without "رقم"', () => {
  const { bag } = extractEntities('اربطه بالعقد V-2026-0007');
  assert.equal(bag.contractRef, 'V-2026-0007');
});
