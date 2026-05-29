import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';

// Settings is OWNER/ADMIN-only for both reads and writes. Lower roles
// never see this module — the navigation already hides it, and the API
// returns 403.
const SETTINGS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new SettingsService(fastify.prisma);
  const controller = new SettingsController(service);

  const guarded = {
    preHandler: [fastify.authenticate, fastify.authorize(SETTINGS_ROLES)],
  };

  // General
  fastify.get('/general', guarded, controller.getGeneral);
  fastify.patch('/general', guarded, controller.updateGeneral);

  // Company profile (singleton)
  fastify.get('/company', guarded, controller.getCompany);
  fastify.patch('/company', guarded, controller.updateCompany);

  // Currencies
  fastify.get('/currencies', guarded, controller.listCurrencies);
  fastify.post('/currencies', guarded, controller.createCurrency);
  fastify.patch('/currencies/:id', guarded, controller.updateCurrency);
  fastify.delete('/currencies/:id', guarded, controller.deleteCurrency);
  fastify.post('/currencies/:id/set-default', guarded, controller.setDefaultCurrency);
};

export default settingsRoutes;
