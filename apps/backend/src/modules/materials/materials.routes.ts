import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
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

  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);
};

export default materialsRoutes;
