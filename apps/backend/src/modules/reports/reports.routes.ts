import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { ReportsService } from './reports.service.js';
import { ReportsController } from './reports.controller.js';

// Reports are read-only. VIEWER is excluded — they can browse operational data
// but not see profitability/cash insights.
const REPORT_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ReportsService(fastify.prisma);
  const controller = new ReportsController(service);

  const read = { preHandler: [fastify.authenticate, fastify.authorize(REPORT_ROLES)] };

  fastify.get('/dashboard', read, controller.dashboard);
  fastify.get('/project-profitability', read, controller.listProjectProfitability);
  fastify.get('/project-profitability/:projectId', read, controller.getProjectProfitability);
  fastify.get('/cash-flow', read, controller.cashFlow);
  fastify.get('/overdue-payments', read, controller.overduePayments);
  fastify.get('/delayed-projects', read, controller.delayedProjects);
};

export default reportsRoutes;
