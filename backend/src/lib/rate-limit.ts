// ============================================================
// Per-authenticated-user rate limit for the AI endpoints.
//
// Layered ON TOP of the global per-IP ceiling (see app.ts). The AI routes fan
// out to a *paid* LLM provider (OpenRouter), so a single authenticated user must
// not be able to burn unbounded paid calls — the blunt per-IP limit does not
// distinguish users behind one NAT/tunnel, and is far too loose for this cost.
//
// The bucket key is the USER id, derived by verifying the Bearer token here.
// @fastify/rate-limit evaluates keyGenerator in its `onRequest` hook, which runs
// BEFORE the route's `authenticate` preHandler — so `request.user` is not
// populated yet and we must read the token ourselves. A missing/invalid token
// falls back to the client IP; those requests are rejected by `authenticate`
// anyway, so they never reach the LLM.
//
// NOTE: this is a per-minute BURST guard, not a usage quota. Daily/monthly
// per-user spend caps are a separate, DB-backed feature — no quota system exists
// yet, so that is intentionally deferred (TODO: usage quotas).
// ============================================================

import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwt.js';

const BEARER_PREFIX = 'Bearer ';

export interface AiRateLimitConfig {
  max: number;
  timeWindow: string;
  keyGenerator: (request: FastifyRequest) => string;
}

/** Build a route-level `config.rateLimit` value that throttles per authenticated
 *  user (falling back to IP for anonymous/invalid-token requests). */
export function aiUserRateLimit(max: number, timeWindow = '1 minute'): AiRateLimitConfig {
  return {
    max,
    timeWindow,
    keyGenerator(request: FastifyRequest): string {
      const header = request.headers.authorization;
      if (header && header.startsWith(BEARER_PREFIX)) {
        try {
          const { sub } = verifyAccessToken(header.slice(BEARER_PREFIX.length).trim());
          return `ai-user:${sub}`;
        } catch {
          /* fall through to IP for unauthenticated / invalid-token requests */
        }
      }
      return `ai-ip:${request.ip}`;
    },
  };
}
