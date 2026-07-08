import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { aiUserRateLimit } from '../../src/lib/rate-limit.js';
import { signAccessToken } from '../../src/lib/jwt.js';

// Build a tiny app that mirrors app.ts: a loose global per-IP limit, plus a
// strict per-user limit applied to one route via route-level config — exactly
// how the AI routes wire it. No DB required.
async function buildTinyApp(max: number) {
  const app = Fastify();
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });
  app.post('/ai/echo', { config: { rateLimit: aiUserRateLimit(max) } }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

const bearer = (sub: string) => `Bearer ${signAccessToken({ sub, email: null, role: 'OWNER' })}`;

// 1) A single authenticated user is capped, and DIFFERENT users get independent
//    buckets — proving the limit keys on the user, not the shared IP.
test('per-user AI rate limit caps one user without affecting another', async () => {
  const app = await buildTinyApp(3);
  try {
    const hit = (sub: string) =>
      app.inject({ method: 'POST', url: '/ai/echo', headers: { authorization: bearer(sub) } });

    // user A: first 3 pass, 4th is throttled.
    assert.equal((await hit('user-A')).statusCode, 200);
    assert.equal((await hit('user-A')).statusCode, 200);
    assert.equal((await hit('user-A')).statusCode, 200);
    const limited = await hit('user-A');
    assert.equal(limited.statusCode, 429, '4th request for the same user is limited');

    // user B shares the same IP but is a SEPARATE bucket — not collateral-limited.
    assert.equal((await hit('user-B')).statusCode, 200, 'a different user is unaffected');
  } finally {
    await app.close();
  }
});

// 2) An unauthenticated / invalid-token request falls back to an IP bucket
//    (still limited) rather than throwing inside the keyGenerator.
test('per-user AI rate limit falls back to IP for anonymous requests', async () => {
  const app = await buildTinyApp(2);
  try {
    const anon = () => app.inject({ method: 'POST', url: '/ai/echo' });
    assert.equal((await anon()).statusCode, 200);
    assert.equal((await anon()).statusCode, 200);
    assert.equal((await anon()).statusCode, 429, 'anonymous requests are IP-limited, not crashing');
  } finally {
    await app.close();
  }
});

// 3) The keyGenerator itself: authenticated → per-user key; anonymous → per-IP.
test('aiUserRateLimit keys on the verified user id', () => {
  const cfg = aiUserRateLimit(20);
  const userKey = cfg.keyGenerator({ headers: { authorization: bearer('u-42') }, ip: '10.0.0.1' } as never);
  assert.equal(userKey, 'ai-user:u-42', 'authenticated request keyed by user id');

  const ipKey = cfg.keyGenerator({ headers: {}, ip: '10.0.0.1' } as never);
  assert.equal(ipKey, 'ai-ip:10.0.0.1', 'anonymous request keyed by IP');

  const badKey = cfg.keyGenerator({ headers: { authorization: 'Bearer not.a.jwt' }, ip: '10.0.0.2' } as never);
  assert.equal(badKey, 'ai-ip:10.0.0.2', 'invalid token falls back to IP, no throw');
});
