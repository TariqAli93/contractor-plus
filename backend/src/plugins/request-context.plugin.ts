import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { runWithRequestContext } from '../lib/request-context-store.js';

// Backward-compatible re-exports: `getRequestContext` (and the `RequestContext`
// type) previously lived in this module. They now live in the standalone store
// so the logger can read the context without depending on a Fastify plugin
// (BACKEND.md §15.3). Existing importers are unaffected.
export { getRequestContext } from '../lib/request-context-store.js';
export type { RequestContext } from '../lib/request-context-store.js';

const requestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', (request, _reply, done) => {
    // `runWithRequestContext` establishes the async-local context for the whole
    // request by invoking `done` inside it. `userId` is filled in later, by the
    // auth plugin, once the token is verified (fixes B2).
    runWithRequestContext(
      {
        reqId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
      },
      done,
    );
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
