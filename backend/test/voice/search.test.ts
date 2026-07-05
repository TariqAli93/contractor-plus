import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import { SearchHandler } from '../../src/modules/voice/engine/intents/search.handler.js';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';

const actor = { userId: 'u1', role: 'OWNER', ipAddress: '127.0.0.1', userAgent: 'test' };
const handler = new SearchHandler();
const plan = (transcript: string) =>
  handler.plan({ intent: 'search', bag: {}, context: {}, actor, transcript });

test('search extracts the query and opens the palette (client, no confirmation)', () => {
  const p = plan('ابحث عن أحمد');
  assert.equal(p.side, 'client');
  assert.equal(p.mutates, false);
  assert.deepEqual(p.clientActions, [{ type: 'open_palette', query: 'أحمد' }]);
});

test('search strips a preposition + entity-type noun from the query', () => {
  const p = plan('دور على مشروع الفلة');
  assert.deepEqual(p.clientActions, [{ type: 'open_palette', query: 'الفلة' }]);
});

test('search with no term still opens the palette (empty — never a dead end)', () => {
  const p = plan('ابحث');
  assert.deepEqual(p.clientActions, [{ type: 'open_palette' }]);
});

test('rule-based NLU routes "ابحث عن ..." to SEARCH', async () => {
  const nlu = new RuleBasedNluProvider();
  const r = await nlu.interpret('ابحث عن العميل أحمد', { locale: 'ar' });
  assert.equal(r.intent, VoiceIntent.SEARCH);
});
