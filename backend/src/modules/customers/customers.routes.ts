import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
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

  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['customers.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('customers.create'), controller.create);
  fastify.patch('/:id', g('customers.update'), controller.update);
  fastify.delete('/:id', g('customers.delete'), controller.remove);
};

export default customersRoutes;
