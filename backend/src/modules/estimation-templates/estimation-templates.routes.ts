import type { FastifyPluginAsync } from 'fastify';
import { EstimationTemplatesService } from './estimation-templates.service.js';
import { EstimationTemplatesController } from './estimation-templates.controller.js';

// Mounted at /api/v1/estimation-templates (see app.ts). Draft-lifecycle routes
// live under /drafts/* so they never collide with the confirmed-template
// /:id routes at the root.
//
//   POST  /drafts                              — generate | clarify | refine a draft
//   GET   /drafts/:draftId                      — inspect a draft
//   POST  /drafts/:draftId/resolve-materials    — approve/skip missing materials
//   PATCH /drafts/:draftId/items/:tempId        — manual line-item edit
//   PATCH /drafts/:draftId/waste-percentage     — change waste %
//   GET   /drafts/:draftId/preview              — full pre-save preview + warning
//   POST  /drafts/:draftId/confirm              — execute (create materials + template)
//   POST  /drafts/:draftId/cancel               — abandon a draft
//   GET / , GET /:id , PATCH /:id , DELETE /:id — confirmed-template CRUD
const estimationTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new EstimationTemplatesService(fastify.prisma);
  const controller = new EstimationTemplatesController(service);

  // Using the assistant requires `ai_generate`; the service still re-checks the
  // real per-action permission (materials.create_from_assistant,
  // estimation_templates.create) on every fan-out step.
  const aiGen = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['estimation_templates.ai_generate'] }),
    ],
  };
  // Confirming saves data — needs BOTH the assistant grant and create rights.
  const confirmGate = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({
        permissions: ['estimation_templates.ai_generate', 'estimation_templates.create'],
        mode: 'all',
      }),
    ],
  };
  const read = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['estimation_templates.read'] }),
    ],
  };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission] })],
  });

  // AI draft lifecycle
  fastify.post('/drafts', aiGen, controller.generate);
  fastify.get('/drafts/:draftId', aiGen, controller.getDraft);
  fastify.post('/drafts/:draftId/resolve-materials', aiGen, controller.resolveMaterials);
  fastify.patch('/drafts/:draftId/items/:tempId', aiGen, controller.updateItem);
  fastify.patch('/drafts/:draftId/waste-percentage', aiGen, controller.updateWaste);
  fastify.get('/drafts/:draftId/preview', aiGen, controller.preview);
  fastify.post('/drafts/:draftId/confirm', confirmGate, controller.confirm);
  fastify.post('/drafts/:draftId/cancel', aiGen, controller.cancel);

  // Confirmed templates
  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.patch('/:id', g('estimation_templates.update'), controller.update);
  fastify.delete('/:id', g('estimation_templates.delete'), controller.remove);
};

export default estimationTemplatesRoutes;
