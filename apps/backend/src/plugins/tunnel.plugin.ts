import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { TunnelService } from '../modules/tunnel/tunnel.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    tunnelService: TunnelService;
  }
}

const tunnelPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new TunnelService(fastify.prisma, fastify.log);
  fastify.decorate('tunnelService', service);
};

export default fp(tunnelPlugin, { name: 'tunnel', dependencies: ['prisma'] });
