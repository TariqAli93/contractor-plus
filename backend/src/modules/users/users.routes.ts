import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

// Hybrid access: per-action users.* permissions with a legacy OWNER/ADMIN
// fallback. Finer rules (OWNER-only for OWNER targets, no self delete/
// deactivate) are enforced in the service.
const MANAGE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const guard = (permission: string) => ({
  permissions: [permission] as const,
  roles: MANAGE_ROLES,
});

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new UsersService(fastify.prisma);
  const controller = new UsersController(service);

  const read = { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.read'))] };

  fastify.get('/', read, controller.list);
  fastify.get('/:id', read, controller.getById);
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.create'))] }, controller.create);
  fastify.patch('/:id', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.update'))] }, controller.update);
  fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.delete'))] }, controller.remove);
  fastify.post('/:id/activate', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.activate'))] }, controller.activate);
  fastify.post('/:id/deactivate', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.activate'))] }, controller.deactivate);
  fastify.post('/:id/reset-password', { preHandler: [fastify.authenticate, fastify.requireAccess(guard('users.reset_password'))] }, controller.resetPassword);
};

export default usersRoutes;
