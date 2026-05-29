import { AsyncLocalStorage } from 'node:async_hooks';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface RequestContext {
  reqId: string;
  ipAddress: string;
  userAgent: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

const requestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', (request, _reply, done) => {
    const ctx: RequestContext = {
      reqId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    };
    storage.run(ctx, done);
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
