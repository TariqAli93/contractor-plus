import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { ChangeOrdersService } from './change-orders.service.js';
import { ChangeOrdersController } from './change-orders.controller.js';

const READ_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

// Change orders are a financial control — writes are OWNER / ADMIN / ACCOUNTANT.
const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];

// One controller instance shared across both route prefixes — see app.ts.
let cachedController: ChangeOrdersController | null = null;
function getController(prisma: import('@prisma/client').PrismaClient): ChangeOrdersController {
  if (!cachedController) {
    cachedController = new ChangeOrdersController(new ChangeOrdersService(prisma));
  }
  return cachedController;
}

// Mounted at /api/v1/change-orders
export const changeOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const read = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['change_orders.read'], roles: READ_ROLES }),
    ],
  };
  const g = (permission: string) => ({
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES }),
    ],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('change_orders.create'), controller.create);
  fastify.patch('/:id', g('change_orders.update'), controller.update);
  fastify.post('/:id/approve', g('change_orders.approve'), controller.approve);
  fastify.post('/:id/reject', g('change_orders.approve'), controller.reject);
  fastify.delete('/:id', g('change_orders.delete'), controller.remove);
};

// Mounted at /api/v1/contracts — contract-scoped views:
//   GET /:id/change-orders
//   GET /:id/change-order-summary
export const contractChangeOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const read = {
    preHandler: [
      fastify.authenticate,
      fastify.requireAccess({ permissions: ['change_orders.read'], roles: READ_ROLES }),
    ],
  };
  fastify.get('/:id/change-orders', read, controller.listForContract);
  fastify.get('/:id/change-order-summary', read, controller.summaryForContract);
};

export default changeOrdersRoutes;
