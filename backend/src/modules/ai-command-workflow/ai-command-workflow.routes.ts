import type { FastifyPluginAsync } from 'fastify';
import { AiCommandWorkflowService } from './ai-command-workflow.service.js';
import { AiCommandWorkflowController } from './ai-command-workflow.controller.js';
import { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';

// Mounted at /api/v1/ai-command (see app.ts).
//
//   POST /interpret            — understand a command → clarification | plan | query
//   POST /confirm              — execute the parked plan after the user confirms
//   POST /cancel               — drop the parked plan
//   GET  /sessions/:sessionId  — inspect session state
//   GET/PATCH/POST /settings*  — LLM provider config (separate, stricter permission)
const aiCommandRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AiCommandWorkflowService(fastify.prisma);
  const settings = new LlmSettingsStore(fastify.prisma);
  const controller = new AiCommandWorkflowController(service, settings);

  // Using the assistant requires `ai.use`; the executor still enforces the real
  // per-action permission (projects.create, customers.create, …) on every step.
  const use = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.use'] })],
  };
  // Configuring the LLM provider/key is a stricter, admin-only capability.
  const manage = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.settings.manage'] })],
  };

  fastify.post('/interpret', use, controller.interpret);
  fastify.post('/confirm', use, controller.confirm);
  fastify.post('/cancel', use, controller.cancel);
  fastify.get('/sessions/:sessionId', use, controller.getSession);
  fastify.get('/insights', use, controller.getInsights);

  fastify.get('/settings', manage, controller.getSettings);
  fastify.patch('/settings', manage, controller.updateSettings);
  fastify.post('/settings/test', manage, controller.testSettings);
};

export default aiCommandRoutes;
