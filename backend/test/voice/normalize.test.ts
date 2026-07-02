import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArabic,
  parseNumberToken,
  toWesternDigits,
  tokenize,
} from '../../src/modules/voice/nlu/normalize.js';

test('toWesternDigits converts Eastern-Arabic digits', () => {
  assert.equal(toWesternDigits('١٠٠'), '100');
  assert.equal(toWesternDigits('مساحة ٢٠٠'), 'مساحة 200');
});

test('normalizeArabic unifies alef/ta-marbuta/alef-maqsura and strips diacritics', () => {
  assert.equal(normalizeArabic('أنشئ'), 'انشي');
  assert.equal(normalizeArabic('إبدأ'), 'ابدا');
  assert.equal(normalizeArabic('مَشْرُوع'), 'مشروع');
  assert.equal(normalizeArabic('عمارة'), 'عماره');
  assert.equal(normalizeArabic('مُستشفى'), 'مستشفي');
});

test('parseNumberToken handles digits and spoken numbers', () => {
  assert.equal(parseNumberToken('100'), 100);
  assert.equal(parseNumberToken('خمسين'), 50);
  assert.equal(parseNumberToken('مئه'), 100);
  assert.equal(parseNumberToken('عشرين'), 20);
  assert.equal(parseNumberToken('بيت'), null);
});

test('tokenize keeps original + normalised forms', () => {
  const toks = tokenize('سوي مشروع');
  assert.deepEqual(
    toks.map((t) => t.norm),
    ['سوي', 'مشروع'],
  );
});
