import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, REDACTED } from '../../src/lib/log-redaction.js';

test('redacts secrets nested at any depth', () => {
  const out = redactSecrets({
    user: { fullName: 'Tariq', passwordHash: 'abc', tokenHash: 'xyz' },
    req: {
      headers: { authorization: 'Bearer t', cookie: 'sid=1', 'user-agent': 'ua' },
    },
    integration: { config: { apiKey: 'k', endpoint: 'https://api' } },
    auth: { refreshToken: 'r', jwtSecret: 's' },
  }) as Record<string, any>;

  assert.equal(out.user.passwordHash, REDACTED);
  assert.equal(out.user.tokenHash, REDACTED);
  assert.equal(out.user.fullName, 'Tariq'); // preserved
  assert.equal(out.req.headers.authorization, REDACTED);
  assert.equal(out.req.headers.cookie, REDACTED);
  assert.equal(out.req.headers['user-agent'], 'ua'); // preserved
  assert.equal(out.integration.config.apiKey, REDACTED);
  assert.equal(out.integration.config.endpoint, 'https://api'); // preserved
  assert.equal(out.auth.refreshToken, REDACTED);
  assert.equal(out.auth.jwtSecret, REDACTED);
});

test('does NOT over-redact non-secret fields that merely contain a sensitive word', () => {
  const out = redactSecrets({
    metrics: { promptTokens: 120, completionTokens: 40, tokenCount: 160 },
    cookieConsent: true,
  }) as Record<string, any>;

  assert.equal(out.metrics.promptTokens, 120);
  assert.equal(out.metrics.tokenCount, 160);
  assert.equal(out.cookieConsent, true);
});

test('handles arrays, primitives, null, and circular references safely', () => {
  const cyclic: Record<string, unknown> = { name: 'x' };
  cyclic.self = cyclic;
  const out = redactSecrets({
    list: [{ password: 'p' }, 'plain', 42, null],
    cyclic,
  }) as Record<string, any>;

  assert.equal(out.list[0].password, REDACTED);
  assert.equal(out.list[1], 'plain');
  assert.equal(out.list[2], 42);
  assert.equal(out.list[3], null);
  assert.equal(out.cyclic.self, '[Circular]');
});

test('redacts secret fields carried on an Error while preserving its shape', () => {
  const err = Object.assign(new Error('boom'), { apiKey: 'k', code: 'X' });
  const out = redactSecrets(err) as Record<string, any>;
  assert.equal(out.message, 'boom');
  assert.equal(out.name, 'Error');
  assert.equal(out.apiKey, REDACTED);
  assert.equal(out.code, 'X');
});
