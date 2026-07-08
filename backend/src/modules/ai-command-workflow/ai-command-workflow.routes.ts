import type { FastifyPluginAsync } from 'fastify';
import { AiCommandWorkflowService } from './ai-command-workflow.service.js';
import { AiCommandWorkflowController } from './ai-command-workflow.controller.js';
import { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';
import { OpenRouterModelsService } from '../../lib/llm/openrouter-models.service.js';
import { aiUserRateLimit } from '../../lib/rate-limit.js';

// Mounted at /api/v1/ai-command (see app.ts).
//
//   POST /interpret            — understand a command → clarification | plan | query
//   POST /confirm              — execute the parked plan after the user confirms
//   POST /cancel               — drop the parked plan
//   GET  /sessions/:sessionId  — inspect session state
//   GET  /models               — OpenRouter model catalog (cached, filtered)
//   GET/PATCH/POST /settings*  — OpenRouter config (separate, stricter permission)
const aiCommandRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AiCommandWorkflowService(fastify.prisma);
  const settings = new LlmSettingsStore(fastify.prisma);
  const models = new OpenRouterModelsService(fastify.prisma);
  const controller = new AiCommandWorkflowController(service, settings, models);

  // Using the assistant requires `ai.use`; the executor still enforces the real
  // per-action permission (projects.create, customers.create, …) on every step.
  const use = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.use'] })],
  };
  // Same gate PLUS a strict per-user throttle for the command actions — /interpret
  // spends a paid LLM call, and /confirm executes DB mutations. Keyed on the
  // authenticated user (not just IP), so the global per-IP ceiling can't be
  // shared away behind one tunnel. GET reads stay on the global limit only.
  const useLimited = {
    preHandler: use.preHandler,
    config: { rateLimit: aiUserRateLimit(20) },
  };
  // Configuring the LLM provider/key is a stricter, admin-only capability.
  const manage = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.settings.manage'] })],
  };

  fastify.post('/interpret', useLimited, controller.interpret);
  fastify.post('/confirm', useLimited, controller.confirm);
  fastify.post('/cancel', useLimited, controller.cancel);
  fastify.get('/sessions/:sessionId', use, controller.getSession);
  fastify.get('/insights', use, controller.getInsights);

  fastify.get('/settings', manage, controller.getSettings);
  fastify.patch('/settings', manage, controller.updateSettings);
  fastify.post('/settings/test', manage, controller.testSettings);
  // The model catalog is only useful when configuring the LLM, so it shares the
  // stricter settings permission. It returns public metadata only (never the key).
  fastify.get('/models', manage, controller.getModels);
};

export default aiCommandRoutes;
