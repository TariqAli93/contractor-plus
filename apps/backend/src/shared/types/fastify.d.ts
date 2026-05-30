import 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { RequireAccessOptions } from '../../plugins/rbac.plugin.js';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: Guard;
    // Legacy role guard. `roles` are role-name strings (system or custom).
    authorize: (roles: readonly string[]) => Guard;
    // Hybrid permission-first guard with legacy role fallback.
    requireAccess: (opts: RequireAccessOptions) => Guard;
    loadPermissions: (request: FastifyRequest) => Promise<Set<string>>;
  }

  interface FastifyRequest {
    user?: {
      id: string;
      email: string | null;
      // Role name (system role from RoleName, or a custom role name).
      role: string;
    };
    // Lazily-loaded effective permission keys for the request's user.
    permissionSet?: Set<string>;
  }
}
