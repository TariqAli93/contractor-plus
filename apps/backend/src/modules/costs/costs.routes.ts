import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { CostsService } from './costs.service.js';
import { CostsController } from './costs.controller.js';

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
  RoleName.ENGINEER,
];

// One controller instance shared across both route prefixes — see app.ts.
let cachedController: CostsController | null = null;

function getController(prisma: import('@prisma/client').PrismaClient): CostsController {
  if (!cachedController) {
    cachedController = new CostsController(new CostsService(prisma));
  }
  return cachedController;
}

// Mounted at /api/v1/costs
export const costsRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };
  const write = { preHandler: [fastify.authenticate, fastify.authorize(WRITE_ROLES)] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', write, controller.create);
  fastify.patch('/:id', write, controller.update);
  fastify.delete('/:id', write, controller.remove);
};

// Mounted at /api/v1/projects — exposes project-scoped views:
//   GET /:id/costs
//   GET /:id/cost-summary
export const projectCostsRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const read = { preHandler: [fastify.authenticate, fastify.authorize(READ_ROLES)] };

  fastify.get('/:id/costs', read, controller.listForProject);
  fastify.get('/:id/cost-summary', read, controller.getProjectSummary);
};

export default costsRoutes;
