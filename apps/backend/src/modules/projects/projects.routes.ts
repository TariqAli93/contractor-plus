import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';

const READ_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

// Projects diverge from customers/materials/contracts: ACCOUNTANT is read-only.
// Lifecycle belongs to operations (OWNER/ADMIN/ENGINEER).
const WRITE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ENGINEER,
];

const projectsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ProjectsService(fastify.prisma);
  const controller = new ProjectsController(service);

  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);

  fastify.post('/:id/start', write, controller.start);
  fastify.post('/:id/pause', write, controller.pause);
  fastify.post('/:id/resume', write, controller.resume);
  fastify.post('/:id/complete', write, controller.complete);
  fastify.post('/:id/cancel', write, controller.cancel);
};

export default projectsRoutes;
