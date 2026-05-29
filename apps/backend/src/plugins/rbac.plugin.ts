import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RoleName } from '@prisma/client';
import { UnauthorizedError } from '../shared/errors/unauthorized.error.js';
import { ForbiddenError } from '../shared/errors/forbidden.error.js';

const rbacPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authorize', (roles: RoleName[]) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.user) {
        throw new UnauthorizedError('Authentication required', 'TOKEN_MISSING');
      }
      if (!roles.includes(request.user.role)) {
        throw new ForbiddenError(
          `Insufficient role. Requires one of: ${roles.join(', ')}`,
          'INSUFFICIENT_ROLE',
        );
      }
    };
  });
};

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth'] });
