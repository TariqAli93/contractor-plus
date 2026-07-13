import type { FastifyPluginAsync } from 'fastify';
import { AiAssistantService } from './ai-assistant.service.js';
import { AiAssistantController } from './ai-assistant.controller.js';

// AI routes are permission-only (no legacy-role fallback): the module is new,
// so there are no un-migrated clients to keep compatible.
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
  const syncMaterialPrices = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['ai.sync-material-prices'] }),
    ],
  };
  const manageSettings = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['ai.manage-settings'] }),
    ],
  };

  fastify.get('/status', use, controller.status);
  // Phase 6 — governance view: config reflection + live monthly usage.
  fastify.get('/settings', manageSettings, controller.settings);
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
  // Phase 5 — external material reference prices. Manual sync is permissioned;
  // the reads sit behind ai.use so the material form/dashboard can show them.
  fastify.post('/materials/sync-prices', syncMaterialPrices, controller.syncMaterialPrices);
  fastify.get('/materials/price-changes', use, controller.materialPriceChanges);
  fastify.get('/materials/:materialId/reference-price', use, controller.materialReferencePrice);
};

export default aiAssistantRoutes;
