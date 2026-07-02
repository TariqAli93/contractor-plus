import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import {
  hasConnector,
  segmentIntents,
  splitSegments,
} from '../../src/modules/voice/engine/compound-segmenter.js';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';

const nlu = new RuleBasedNluProvider();
const opts = { nlu, isKnown: () => true };

test('hasConnector detects explicit connectors only', () => {
  assert.equal(hasConnector('سوي مشروع، وأضف تكلفة'), true);
  assert.equal(hasConnector('سوي مشروع ثم أضف دفعة'), true);
  assert.equal(hasConnector('سوي مشروع بيت مساحة 100'), false); // bare و-words don't split
});

test('splitSegments splits on comma / ثم but not inside words', () => {
  const segs = splitSegments('سوي مشروع، أنشئ عقد، ثم أضف دفعة');
  assert.equal(segs.length, 3);
});

test('segments the documented 4-intent command into priority order', async () => {
  const invocations = await segmentIntents(
    'سوي مشروع جديد، أنشئ عقد باسم أحمد، أضف المواد، ثم أضف دفعة',
    opts,
  );
  assert.deepEqual(
    invocations.map((i) => i.intent),
    [
      VoiceIntent.CREATE_PROJECT,
      VoiceIntent.CREATE_CONTRACT,
      VoiceIntent.ADD_MATERIALS,
      VoiceIntent.ADD_PAYMENT,
    ],
  );
});

test('reorders by priority regardless of spoken order', async () => {
  const invocations = await segmentIntents('أضف تكلفة 500 ألف، وسوي مشروع بيت مساحة 100', opts);
  // create_project (priority 1) must come before add_cost (priority 4)
  assert.equal(invocations[0]?.intent, VoiceIntent.CREATE_PROJECT);
  assert.equal(invocations[1]?.intent, VoiceIntent.ADD_COST);
});

test('drops unrecognised segments', async () => {
  const invocations = await segmentIntents('سوي مشروع بيت مساحة 100، الجو حار اليوم', opts);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]?.intent, VoiceIntent.CREATE_PROJECT);
});
