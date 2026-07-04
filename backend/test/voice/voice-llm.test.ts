import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidModelForProvider,
  normalizeModel,
} from '../../src/modules/voice/nlu/llm/voice-llm.config.js';
import { mapOpenAiStatus } from '../../src/modules/voice/nlu/llm/llm-client.js';

test('normalizeModel: OpenAI trims + lowercases ("GPT-5.5" → "gpt-5.5")', () => {
  assert.equal(normalizeModel('openai', '  GPT-5.5 '), 'gpt-5.5');
  assert.equal(normalizeModel('openai', 'gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(normalizeModel('openai', 'O1-Mini'), 'o1-mini');
});

test('normalizeModel: Anthropic only trims (case preserved)', () => {
  assert.equal(normalizeModel('anthropic', '  Claude-Haiku-4-5 '), 'Claude-Haiku-4-5');
});

test('isValidModelForProvider: valid OpenAI ids accepted', () => {
  for (const m of ['gpt-4o-mini', 'gpt-5.5', 'o1', 'o3-mini', 'chatgpt-4o-latest']) {
    assert.equal(isValidModelForProvider('openai', m), true, m);
  }
});

test('isValidModelForProvider: a bogus OpenAI id is rejected', () => {
  assert.equal(isValidModelForProvider('openai', 'davinci'), false);
  assert.equal(isValidModelForProvider('openai', 'claude-haiku-4-5'), false);
});

test('isValidModelForProvider: Anthropic accepts anything (case-sensitive ids)', () => {
  assert.equal(isValidModelForProvider('anthropic', 'claude-haiku-4-5'), true);
  assert.equal(isValidModelForProvider('anthropic', 'Whatever'), true);
});

test('mapOpenAiStatus: understandable codes for 401/404/429, raw code otherwise', () => {
  assert.equal(mapOpenAiStatus(401), 'openai_invalid_api_key');
  assert.equal(mapOpenAiStatus(404), 'openai_model_not_found_or_not_available');
  assert.equal(mapOpenAiStatus(429), 'openai_rate_limited');
  assert.equal(mapOpenAiStatus(500), 'openai_http_500');
});
