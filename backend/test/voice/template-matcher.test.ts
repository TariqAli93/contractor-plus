import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTemplates } from '../../src/modules/voice/engine/template-matcher.js';
import { extractEntities } from '../../src/modules/voice/nlu/entity-extractor.js';

// Mirrors the seeded template naming convention (dimensions embedded in the name).
const TEMPLATES = [
  { id: 'a', name: 'بيت 100 متر طابقين — واجهة 6 نزال 16', description: null },
  { id: 'b', name: 'بيت 100 متر طابقين — واجهة 5 نزال 20', description: null },
  { id: 'c', name: 'بيت 100 متر طابقين — واجهة 8 نزال 12', description: null },
  { id: 'd', name: 'بيت 50 متر — طابق واحد', description: null },
  { id: 'e', name: 'بيت 150 متر طابقين — واجهة 10 نزال 15', description: null },
];

test('frontage + depth disambiguate same-area templates (matches the spoken example)', () => {
  const spec = extractEntities('بيت 100 متر واجهة 5 ونزال 20').bag;
  const result = matchTemplates(spec, TEMPLATES);
  assert.equal(result.best?.template.id, 'b');
  assert.equal(result.ambiguous, false);
});

test('area-only is ambiguous among the three 100m² variants', () => {
  const spec = extractEntities('بيت 100 متر').bag;
  const result = matchTemplates(spec, TEMPLATES);
  assert.equal(result.ambiguous, true);
  assert.equal(result.best?.parsedSpec.area, 100);
});

test('a different area selects the closest template', () => {
  const spec = extractEntities('بيت 150 متر واجهة 10 نزال 15').bag;
  const result = matchTemplates(spec, TEMPLATES);
  assert.equal(result.best?.template.id, 'e');
});

test('no candidates when the template list is empty', () => {
  const spec = extractEntities('بيت 100 متر').bag;
  const result = matchTemplates(spec, []);
  assert.equal(result.best, null);
});
