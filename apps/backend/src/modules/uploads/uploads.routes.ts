import type { FastifyPluginAsync } from 'fastify';
import { RoleName } from '@prisma/client';
import { UploadsService } from './uploads.service.js';
import { UploadsController } from './uploads.controller.js';

// Uploads, like the rest of /settings, are OWNER/ADMIN-only for both reads
// and writes. Public asset serving lives behind /uploads/* (read-only,
// unauthenticated) and is mounted in app.ts via @fastify/static.
const UPLOAD_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new UploadsService(fastify.prisma);
  const controller = new UploadsController(service);

  const guarded = {
    preHandler: [fastify.authenticate, fastify.authorize(UPLOAD_ROLES)],
  };

  // Read both assets in one go — used by the Company Profile tab on load.
  fastify.get('/company', guarded, controller.getCompanyAssets);
  // Convenience aliases — match the spec's per-asset GETs.
  fastify.get('/company/logo', guarded, controller.getCompanyAssets);
  fastify.get('/company/stamp', guarded, controller.getCompanyAssets);

  // Write endpoints. Multipart parsing is handled globally via
  // @fastify/multipart (registered in app.ts).
  fastify.post('/company/:kind', guarded, controller.uploadCompanyAsset);
  fastify.delete('/company/:kind', guarded, controller.deleteCompanyAsset);
};

export default uploadsRoutes;
