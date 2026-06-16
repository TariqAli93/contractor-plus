import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { TunnelController } from './tunnel.controller.js';

// Tunnel control is OWNER + ADMIN only. The local backend never holds
// Cloudflare credentials — those stay server-side in codel-management-api.
const TUNNEL_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const tunnelRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = new TunnelController(fastify.tunnelService);

  // Hybrid: tunnel.manage permission OR legacy OWNER/ADMIN.
  const guarded = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['tunnel.manage'], roles: TUNNEL_ROLES })],
  };

  fastify.get('/status', guarded, controller.status);
  fastify.post('/enable', guarded, controller.enable);
  fastify.post('/disable', guarded, controller.disable);
};

export default tunnelRoutes;
