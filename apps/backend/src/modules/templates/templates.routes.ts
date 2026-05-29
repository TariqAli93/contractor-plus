import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
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

  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  // Templates
  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);

  // Items
  fastify.post('/:id/items', write, controller.addItem);
  fastify.patch('/:id/items/:itemId', write, controller.updateItem);
  fastify.delete('/:id/items/:itemId', write, controller.removeItem);

  // Steps
  fastify.post('/:id/steps', write, controller.addStep);
  fastify.patch('/:id/steps/:stepId', write, controller.updateStep);
  fastify.delete('/:id/steps/:stepId', write, controller.removeStep);

  // Estimate
  fastify.get('/:id/estimate', read, controller.getEstimate);
};

export default templatesRoutes;
