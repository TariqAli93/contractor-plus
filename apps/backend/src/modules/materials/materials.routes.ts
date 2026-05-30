import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { MaterialsService } from './materials.service.js';
import { MaterialsController } from './materials.controller.js';

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

const materialsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new MaterialsService(fastify.prisma);
  const controller = new MaterialsController(service);

  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['materials.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('materials.create'), controller.create);
  fastify.patch('/:id', g('materials.update'), controller.update);
  fastify.delete('/:id', g('materials.delete'), controller.remove);
};

export default materialsRoutes;
