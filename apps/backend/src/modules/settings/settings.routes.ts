import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@contractor-plus/shared';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';

// Hybrid access: permission-first with legacy OWNER/ADMIN fallback.
const SETTINGS_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new SettingsService(fastify.prisma);
  const controller = new SettingsController(service);

  const read = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['settings.read'], roles: SETTINGS_ROLES })],
  };
  const manage = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['settings.manage'], roles: SETTINGS_ROLES })],
  };
  const company = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['settings.company.manage'], roles: SETTINGS_ROLES })],
  };
  const currency = {
    preHandler: [fastify.authenticate, fastify.requireAccess({ permissions: ['settings.currency.manage'], roles: SETTINGS_ROLES })],
  };

  // General
  fastify.get('/general', read, controller.getGeneral);
  fastify.patch('/general', manage, controller.updateGeneral);

  // Company profile (singleton)
  fastify.get('/company', read, controller.getCompany);
  fastify.patch('/company', company, controller.updateCompany);

  // Currencies
  fastify.get('/currencies', read, controller.listCurrencies);
  fastify.post('/currencies', currency, controller.createCurrency);
  fastify.patch('/currencies/:id', currency, controller.updateCurrency);
  fastify.delete('/currencies/:id', currency, controller.deleteCurrency);
  fastify.post('/currencies/:id/set-default', currency, controller.setDefaultCurrency);
};

export default settingsRoutes;
