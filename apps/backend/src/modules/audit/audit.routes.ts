import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

// Audit access is restricted — OWNER and ADMIN only. ACCOUNTANT, ENGINEER,
// and VIEWER never read the audit log; sensitive PII (email, IP, full row
// snapshots) lives in there.
const AUDIT_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuditService(fastify.prisma);
  const controller = new AuditController(service);

  // Hybrid: audit.read permission OR legacy OWNER/ADMIN.
  const read = { preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['audit.read'], roles: AUDIT_ROLES })] };

  fastify.get('/logs', read, controller.listLogs);
  fastify.get('/logs/:id', read, controller.getLogById);
  fastify.get('/entity/:entity/:entityId', read, controller.getEntityHistory);
  fastify.get('/user/:userId', read, controller.getUserHistory);
};

export default auditRoutes;
