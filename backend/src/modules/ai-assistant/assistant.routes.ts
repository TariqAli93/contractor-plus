import type { FastifyPluginAsync } from 'fastify';
import { AssistantOrchestrator } from './assistant.orchestrator.js';
import { AuditQueryService } from './audit-query.service.js';
import { AssistantController } from './assistant.controller.js';
import { aiUserRateLimit } from '../../lib/rate-limit.js';

// Mounted at /api/v1/ai (see app.ts) — the ONE surface every AI capability flows
// through (supersedes the legacy /ai-command console + estimation AI routes;
// those stay mounted for backward compatibility but the SPA no longer calls them).
//
// Coarse gate: `ai.session.use`; the orchestrator then re-checks each plan step's
// real permissions at execute-time (dual-layer). The unified audit read is gated
// on `audit.read` (OWNER/ADMIN).
//
//   POST /session                 — open a durable session
//   GET  /sessions                — list my sessions
//   GET  /session/:id             — inspect a session (messages, working state)
//   POST /session/:id/message     — one NL turn → answer|clarification|preview|query|execution|rejected|error
//   POST /session/:id/confirm     — execute the parked plan (atomic-claimed)
//   POST /session/:id/cancel      — cancel the session / parked plan
//   GET  /tools                   — tools + actions the caller may use
//   GET  /audit                   — unified AiExecution trail (filterable)
const assistantRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AssistantOrchestrator(fastify.prisma);
  const audit = new AuditQueryService(fastify.prisma);
  const controller = new AssistantController(service, audit);

  const use = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.session.use'] })],
  };
  // Same gate PLUS a strict per-authenticated-user throttle on the POST turns —
  // /message spends a paid LLM call and /confirm executes DB mutations.
  const useLimited = {
    preHandler: use.preHandler,
    config: { rateLimit: aiUserRateLimit(20) },
  };
  const auditRead = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['audit.read'] })],
  };

  fastify.post('/session', useLimited, controller.openSession);
  fastify.get('/sessions', use, controller.listSessions);
  fastify.get('/session/:id', use, controller.getSession);
  fastify.post('/session/:id/message', useLimited, controller.message);
  fastify.post('/session/:id/confirm', useLimited, controller.confirm);
  fastify.post('/session/:id/cancel', useLimited, controller.cancel);
  fastify.get('/tools', use, controller.listTools);
  fastify.get('/audit', auditRead, controller.auditList);
};

export default assistantRoutes;
