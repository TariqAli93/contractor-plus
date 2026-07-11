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
      let permissionCheckFailed = false;
      if (opts.permissions && opts.permissions.length > 0) {
        const perms = await permissionsFor(request);
        const mode = opts.mode ?? 'any';
        const ok =
          mode === 'all'
            ? opts.permissions.every((k) => perms.has(k))
            : opts.permissions.some((k) => perms.has(k));
        if (ok) return;
        permissionCheckFailed = true;
      }

      // 4. Legacy role fallback (F-SEC-1 / B1) — KNOWN LIVE DEFECT.
      //
      // This grants access on a role match EVEN WHEN the permission check above
      // failed, so it only ever widens access: a role in the list passes a route
      // whose permission it was never granted. It is scheduled for removal as the
      // first task of Phase 2 (seed equivalent permission grants, test every
      // affected route, then delete this branch and make authorization
      // permission-only except for the OWNER super-admin rule).
      //
      // Until then the defect must not be invisible: every grant that flows
      // through here AFTER a failed permission check is logged as a structured
      // warning, so it is auditable in production. See SECURITY.md F-SEC-1 and
      // BACKEND.md §12.1.
      if (opts.roles && opts.roles.length > 0 && opts.roles.includes(request.user.role)) {
        if (permissionCheckFailed) {
          request.log.warn(
            {
              event: 'rbac.legacy_role_fallback',
              method: request.method,
              url: request.url,
              userId: request.user.id,
              role: request.user.role,
              requiredPermissions: opts.permissions,
              mode: opts.mode ?? 'any',
            },
            'access granted via legacy role fallback after permission check failed (F-SEC-1; scheduled for removal in Phase 2)',
          );
        }
        return;
      }

      // 5. Deny.
      throw new ForbiddenError('Insufficient permissions', 'INSUFFICIENT_PERMISSION');
    };
  });
};

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth', 'prisma'] });
