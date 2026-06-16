import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { ContractsService } from './contracts.service.js';
import { ContractsController } from './contracts.controller.js';

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

const contractsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ContractsService(fastify.prisma);
  const controller = new ContractsController(service);

  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['contracts.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('contracts.create'), controller.create);
  fastify.patch('/:id', g('contracts.update'), controller.update);
  fastify.delete('/:id', g('contracts.delete'), controller.remove);

  fastify.post('/:id/generate-estimate', g('contracts.update'), controller.generateEstimate);
  fastify.post('/:id/approve', g('contracts.approve'), controller.approve);
  fastify.post('/:id/cancel', g('contracts.cancel'), controller.cancel);
  fastify.post('/:id/create-project', g('projects.create'), controller.createProject);
};

export default contractsRoutes;
