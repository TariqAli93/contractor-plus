import type { FastifyPluginAsync } from 'fastify';
import { PlatformOrchestrator } from './ai-platform.service.js';
import { AiPlatformController } from './ai-platform.controller.js';
import { aiUserRateLimit } from '../../lib/rate-limit.js';

// Mounted at /api/v1/ai (see app.ts). The generic, tool-agnostic surface every
// AI capability flows through. Coarse gate: `ai.session.use`; the platform then
// re-checks each plan step's real permissions at execute-time (dual-layer).
//
//   POST /session                 — open a durable session
//   GET  /sessions                — list my sessions
//   GET  /session/:id             — inspect a session (messages, working state)
//   POST /session/:id/message     — one NL turn → clarification | preview | query | execution | rejected
//   POST /session/:id/confirm     — execute the parked plan
//   POST /session/:id/cancel      — cancel the session / parked plan
//   GET  /tools                   — tools + actions the caller may use
const aiPlatformRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new PlatformOrchestrator(fastify.prisma);
  const controller = new AiPlatformController(service);

  const use = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.session.use'] })],
  };
  // Same gate PLUS a strict per-authenticated-user throttle on the POST turns —
  // /message spends a paid LLM call and /confirm executes DB mutations. Keyed on
  // the user, not just IP. GET reads stay on the global per-IP limit only.
  const useLimited = {
    preHandler: use.preHandler,
    config: { rateLimit: aiUserRateLimit(20) },
  };

  fastify.post('/session', useLimited, controller.openSession);
  fastify.get('/sessions', use, controller.listSessions);
  fastify.get('/session/:id', use, controller.getSession);
  fastify.post('/session/:id/message', useLimited, controller.message);
  fastify.post('/session/:id/confirm', useLimited, controller.confirm);
  fastify.post('/session/:id/cancel', useLimited, controller.cancel);
  fastify.get('/tools', use, controller.listTools);
};

export default aiPlatformRoutes;
