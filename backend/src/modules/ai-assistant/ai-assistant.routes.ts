import type { FastifyPluginAsync } from 'fastify';
import { AiAssistantService } from './ai-assistant.service.js';
import { AiAssistantController } from './ai-assistant.controller.js';

// AI routes are permission-only (no legacy-role fallback): the module is new,
// so there are no un-migrated clients to keep compatible. Remaining phase:
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
  const viewRecommendations = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['ai.view-recommendations'] }),
    ],
  };
  const applySuggestions = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['ai.apply-suggestions'] }),
    ],
  };

  fastify.get('/status', use, controller.status);
  // Phase 2 — read-only narrative over the numeric reports.
  fastify.post('/reports/:reportType/narrative', generateReports, controller.reportNarrative);
  // Phase 3 — NL text → constrained query → validation gate → ReportsService.
  fastify.post('/reports/query', generateReports, controller.nlReportQuery);
  // Phase 4 — advisory guards (never block) + recommendations + the explicit
  // approval path (the ONLY way a suggestion touches domain data).
  fastify.post('/guard/cost', use, controller.guardCost);
  fastify.post('/guard/payment', use, controller.guardPayment);
  fastify.get('/recommendations', viewRecommendations, controller.listRecommendations);
  fastify.post('/suggestions/:id/apply', applySuggestions, controller.applySuggestion);
  fastify.post('/suggestions/:id/reject', applySuggestions, controller.rejectSuggestion);
};

export default aiAssistantRoutes;
