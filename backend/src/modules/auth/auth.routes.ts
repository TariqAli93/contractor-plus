import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

// Tight, per-IP throttles on the credential endpoints, layered on top of the
// app-wide limiter (see app.ts). These endpoints are the brute-force /
// credential-stuffing surface, so they are far stricter than the global ceiling.
// Values are centralised here for easy tuning.
//
// NOTE: an IP throttle is a blunt instrument on its own — it should be paired
// with per-account lockout (failedLoginCount / lockedUntil on the user) to also
// defend slow, distributed guessing. That is a separate DB-schema change called
// out in the audit (§9) and is not part of this change.
const LOGIN_RATE_LIMIT = { max: 5, timeWindow: '15 minutes' };
const REFRESH_RATE_LIMIT = { max: 30, timeWindow: '15 minutes' };

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuthService(fastify.prisma);
  const controller = new AuthController(service);

  // Login — credentials in body; on success plants the HttpOnly refresh cookie
  // and the CSRF cookies. Strict per-IP throttling blunts brute-force.
  fastify.post('/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, controller.login);

  // Refresh / logout authenticate via the HttpOnly refresh cookie, so they are
  // CSRF-guarded (double-submit: the X-XSRF-TOKEN header must match the secret).
  fastify.post(
    '/refresh',
    { onRequest: fastify.csrfProtection, config: { rateLimit: REFRESH_RATE_LIMIT } },
    controller.refresh,
  );
  fastify.post('/logout', { onRequest: fastify.csrfProtection }, controller.logout);

  // Authenticated — Bearer access token required
  fastify.post('/logout-all', { preHandler: [fastify.authenticate] }, controller.logoutAll);
  fastify.get('/me', { preHandler: [fastify.authenticate] }, controller.me);
};

export default authRoutes;
