import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
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

  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['projects.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('projects.create'), controller.create);
  fastify.patch('/:id', g('projects.update'), controller.update);
  fastify.delete('/:id', g('projects.delete'), controller.remove);

  fastify.post('/:id/start', g('projects.start'), controller.start);
  fastify.post('/:id/pause', g('projects.pause'), controller.pause);
  fastify.post('/:id/resume', g('projects.resume'), controller.resume);
  fastify.post('/:id/complete', g('projects.complete'), controller.complete);
  fastify.post('/:id/cancel', g('projects.cancel'), controller.cancel);
};

export default projectsRoutes;
