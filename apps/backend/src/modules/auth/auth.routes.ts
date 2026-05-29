import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuthService(fastify.prisma);
  const controller = new AuthController(service);

  // Public — credentials in body
  fastify.post('/login', controller.login);
  fastify.post('/refresh', controller.refresh);
  fastify.post('/logout', controller.logout);

  // Authenticated — Bearer access token required
  fastify.post('/logout-all', { preHandler: [fastify.authenticate] }, controller.logoutAll);
  fastify.get('/me', { preHandler: [fastify.authenticate] }, controller.me);
};

export default authRoutes;
