import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../shared/errors/unauthorized.error.js';
import { setRequestUser } from '../lib/request-context-store.js';

const BEARER_PREFIX = 'Bearer ';

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const header = request.headers.authorization;
      if (!header || !header.startsWith(BEARER_PREFIX)) {
        throw new UnauthorizedError('Missing or invalid Authorization header', 'TOKEN_MISSING');
      }
      const token = header.slice(BEARER_PREFIX.length).trim();
      try {
        const payload = verifyAccessToken(token);
        request.user = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
        };
        // Fixes B2: the request-context store is created in `onRequest`, before
        // authentication, so `userId` was always undefined and every log line
        // was unattributable. Populate it now that the token is verified. This
        // is provenance for LOGGING only; authorization uses the Principal.
        setRequestUser(payload.sub);
      } catch {
        throw new UnauthorizedError('Invalid or expired access token', 'TOKEN_INVALID');
      }
    },
  );
};

export default fp(authPlugin, { name: 'auth' });
