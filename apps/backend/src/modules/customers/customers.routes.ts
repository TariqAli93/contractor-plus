import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';

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

const customersRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new CustomersService(fastify.prisma);
  const controller = new CustomersController(service);

  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);
};

export default customersRoutes;
