import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { UnauthorizedError } from '../shared/errors/unauthorized.error.js';
import { ForbiddenError } from '../shared/errors/forbidden.error.js';
import { AccessService } from '../modules/rbac/access.service.js';

export interface RequireAccessOptions {
  permissions?: readonly string[];
  roles?: readonly string[];
  mode?: 'any' | 'all';
}

const rbacPlugin: FastifyPluginAsync = async (fastify) => {
  const access = new AccessService(fastify.prisma);

  // Per-request memoized permission set (loaded lazily, at most once).
  async function permissionsFor(request: FastifyRequest): Promise<Set<string>> {
    if (request.permissionSet) return request.permissionSet;
    const keys = request.user ? await access.permissionsForRole(request.user.role) : [];
    request.permissionSet = new Set(keys);
    return request.permissionSet;
  }
  fastify.decorate('loadPermissions', permissionsFor);

  // ---- Legacy role guard (unchanged behavior; kept for un-migrated routes) ----
  fastify.decorate('authorize', (roles: readonly string[]) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.user) throw new UnauthorizedError('Authentication required', 'TOKEN_MISSING');
      if (!roles.includes(request.user.role)) {
        throw new ForbiddenError(
          `Insufficient role. Requires one of: ${roles.join(', ')}`,
          'INSUFFICIENT_ROLE',
        );
      }
    };
  });

  // ---- Hybrid access guard (permission-first, legacy-role fallback) ----
  fastify.decorate('requireAccess', (opts: RequireAccessOptions) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.user) throw new UnauthorizedError('Authentication required', 'TOKEN_MISSING');

      // 1. OWNER is always super-admin.
      if (request.user.role === RoleName.OWNER) return;

      // 2-3. Permission check.
      if (opts.permissions && opts.permissions.length > 0) {
        const perms = await permissionsFor(request);
        const mode = opts.mode ?? 'any';
        const ok =
          mode === 'all'
            ? opts.permissions.every((k) => perms.has(k))
            : opts.permissions.some((k) => perms.has(k));
        if (ok) return;
      }

      // 4. Legacy role fallback.
      if (opts.roles && opts.roles.length > 0 && opts.roles.includes(request.user.role)) return;

      // 5. Deny.
      throw new ForbiddenError('Insufficient permissions', 'INSUFFICIENT_PERMISSION');
    };
  });
};

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth', 'prisma'] });
