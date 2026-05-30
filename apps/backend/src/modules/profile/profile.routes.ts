import type { FastifyPluginAsync } from 'fastify';
import { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';

// Self-service: any authenticated user manages their own profile. No role
// guard — the user id is taken from the token, never from the request body.
const profileRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new ProfileService(fastify.prisma);
  const controller = new ProfileController(service);

  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/', auth, controller.get);
  fastify.patch('/', auth, controller.update);
  fastify.post('/change-password', auth, controller.changePassword);
};

export default profileRoutes;
