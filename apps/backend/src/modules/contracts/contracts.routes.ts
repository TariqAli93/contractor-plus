import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
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

  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);

  fastify.post('/:id/generate-estimate', write, controller.generateEstimate);
  fastify.post('/:id/approve', write, controller.approve);
  fastify.post('/:id/cancel', write, controller.cancel);
  fastify.post('/:id/create-project', write, controller.createProject);
};

export default contractsRoutes;
