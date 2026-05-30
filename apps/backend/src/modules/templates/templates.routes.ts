import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { TemplatesService } from './templates.service.js';
import { TemplatesController } from './templates.controller.js';

const READ_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

const WRITE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
];

const templatesRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new TemplatesService(fastify.prisma);
  const controller = new TemplatesController(service);

  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['templates.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  // Templates
  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('templates.create'), controller.create);
  fastify.patch('/:id', g('templates.update'), controller.update);
  fastify.delete('/:id', g('templates.delete'), controller.remove);

  // Items (template composition is an update of the template)
  fastify.post('/:id/items', g('templates.update'), controller.addItem);
  fastify.patch('/:id/items/:itemId', g('templates.update'), controller.updateItem);
  fastify.delete('/:id/items/:itemId', g('templates.update'), controller.removeItem);

  // Steps
  fastify.post('/:id/steps', g('templates.update'), controller.addStep);
  fastify.patch('/:id/steps/:stepId', g('templates.update'), controller.updateStep);
  fastify.delete('/:id/steps/:stepId', g('templates.update'), controller.removeStep);

  // Estimate
  fastify.get('/:id/estimate', read, controller.getEstimate);
};

export default templatesRoutes;
