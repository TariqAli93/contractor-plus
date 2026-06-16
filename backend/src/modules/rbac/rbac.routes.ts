import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { RbacService } from './rbac.service.js';
import { RbacController } from './rbac.controller.js';

// Hybrid access:
//   - read: rbac.read permission (ADMIN holds it) OR legacy OWNER/ADMIN.
//   - manage: rbac.manage permission (OWNER-only) OR legacy OWNER.
const VIEW = { permissions: ['rbac.read'] as const, roles: [RoleName.OWNER, RoleName.ADMIN] as const };
const MANAGE = { permissions: ['rbac.manage'] as const, roles: [RoleName.OWNER] as const };

const rbacRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new RbacService(fastify.prisma);
  const controller = new RbacController(service);

  const view = { preHandler: [fastify.authenticate, fastify.requireAccess(VIEW)] };
  const manage = { preHandler: [fastify.authenticate, fastify.requireAccess(MANAGE)] };

  // Read
  fastify.get('/permissions', view, controller.getPermissions);
  fastify.get('/matrix', view, controller.getMatrix);
  fastify.get('/roles', view, controller.listRoles);
  fastify.get('/roles/:id', view, controller.getRole);
  fastify.get('/roles/:id/permissions', view, controller.getRolePermissions);

  // Manage (OWNER)
  fastify.post('/roles', manage, controller.createRole);
  fastify.patch('/roles/:id', manage, controller.updateRole);
  fastify.delete('/roles/:id', manage, controller.deleteRole);
  fastify.put('/roles/:id/permissions', manage, controller.setRolePermissions);
};

export default rbacRoutes;
