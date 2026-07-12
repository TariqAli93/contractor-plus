import type { FastifyPluginAsync } from 'fastify';
import { AiAssistantService } from './ai-assistant.service.js';
import { AiAssistantController } from './ai-assistant.controller.js';

// AI routes are permission-only (no legacy-role fallback): the module is new,
// so there are no un-migrated clients to keep compatible. Feature endpoints
// register phase by phase:
//   Phase 3: POST /reports/query                   (ai.generate-reports)
//   Phase 4: POST /guard/cost|payment, GET /recommendations,
//            POST /suggestions/:id/apply           (ai.apply-suggestions)
//   Phase 5: POST /materials/sync-prices           (ai.sync-material-prices)
const aiAssistantRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AiAssistantService(fastify.prisma);
  const controller = new AiAssistantController(service);

  const use = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['ai.use'] })],
  };
  const generateReports = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['ai.generate-reports'] }),
    ],
  };

  fastify.get('/status', use, controller.status);
  // Phase 2 — read-only narrative over the numeric reports.
  fastify.post('/reports/:reportType/narrative', generateReports, controller.reportNarrative);
};

export default aiAssistantRoutes;
