import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { TunnelController } from './tunnel.controller.js';

// Tunnel control is OWNER + ADMIN only. The local backend never holds
// Cloudflare credentials — those stay server-side in codel-management-api.
const TUNNEL_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const tunnelRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = new TunnelController(fastify.tunnelService);

  const guarded = { preHandler: [fastify.authenticate, fastify.authorize(TUNNEL_ROLES)] };

  fastify.get('/status', guarded, controller.status);
  fastify.post('/enable', guarded, controller.enable);
  fastify.post('/disable', guarded, controller.disable);
};

export default tunnelRoutes;
