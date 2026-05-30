import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { PaymentsService } from './payments.service.js';
import { PaymentsController } from './payments.controller.js';

const READ_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
  RoleName.VIEWER,
];

// Payments belong to finance — engineers can read but cannot post receipts.
const WRITE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
];

let cachedController: PaymentsController | null = null;

function getController(prisma: import('@prisma/client').PrismaClient): PaymentsController {
  if (!cachedController) {
    cachedController = new PaymentsController(new PaymentsService(prisma));
  }
  return cachedController;
}

// Mounted at /api/v1/payments
export const paymentsRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  // Hybrid: permission-first with legacy role fallback.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['payments.read'], roles: READ_ROLES })] };
  const g = (permission: string) => ({
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: [permission], roles: WRITE_ROLES })],
  });

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', g('payments.create'), controller.create);
  fastify.patch('/:id', g('payments.update'), controller.update);
  fastify.delete('/:id', g('payments.delete'), controller.remove);

  fastify.post('/:id/mark-paid', g('payments.mark_paid'), controller.markPaid);
  fastify.post('/:id/cancel', g('payments.cancel'), controller.cancel);
};

// Mounted at /api/v1/projects — exposes project-scoped views:
//   GET /:id/payments
//   GET /:id/payment-summary
export const projectPaymentsRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = getController(fastify.prisma);
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['payments.read'], roles: READ_ROLES })] };

  fastify.get('/:id/payments', read, controller.listForProject);
  fastify.get('/:id/payment-summary', read, controller.getProjectSummary);
};

export default paymentsRoutes;
