import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from '../../src/modules/voice/nlu/entity-extractor.js';

test('extracts project spec from the documented compound utterance', () => {
  const { bag } = extractEntities('سويلي مشروع بيت مساحة 100 متر واجهة 5 ونزال 20');
  assert.equal(bag.projectType, 'house');
  assert.equal(bag.area, 100);
  assert.equal(bag.frontage, 5);
  assert.equal(bag.depth, 20);
});

test('extracts a multi-token customer name with original spelling', () => {
  const { bag } = extractEntities('العقد باسم أحمد محمد رفعت');
  assert.equal(bag.customerName, 'أحمد محمد رفعت');
});

test('does not bleed following keywords into the captured name', () => {
  const { bag } = extractEntities('سوي عقد باسم أحمد وضيف المواد المناسبة');
  assert.equal(bag.customerName, 'أحمد');
  assert.equal(bag.autoMaterials, true);
});

test('handles spoken numbers and floors', () => {
  const { bag } = extractEntities('عمارة مساحة مئتين طابقين');
  assert.equal(bag.projectType, 'building');
  assert.equal(bag.area, 200);
  assert.equal(bag.floors, 2);
});

test('resolves a navigation route', () => {
  const { bag } = extractEntities('افتح المشاريع');
  assert.equal(bag.route, '/projects');
});

test('flags auto-materials request', () => {
  const { bag } = extractEntities('ضيف المواد المناسبة');
  assert.equal(bag.autoMaterials, true);
});
